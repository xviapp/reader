import { AiEngineError, type AiEngine } from '@/core/ai/ai-engine';
import { AI_TASK_MAX_AUTOMATIC_RETRIES, type AiTask, type AiTaskRunner } from '@/core/ai/ai-task-runner';
import { readWatchedItem, readWatchedSnapshot } from '@/core/data/repository-utils';
import type { ReaderPrompt } from '../domain/model';
import type { ReaderLibraryRepository, ReaderSettingsRepository, ReaderTaskRepository } from './ports';
import { renderReaderPrompt } from './prompt-renderer';
import { parseReaderAnalysisResponse } from './reader-analysis-result';
import { parseOrganizedText } from './reader-organization-result';
import { ORGANIZE_OPERATION, ANALYSIS_OPERATION, USER_STOPPED_ORGANIZATION, USER_STOPPED_ANALYSIS, type PassageTaskPayload } from './passage-task';

export type ReaderAiTaskRepository = Pick<ReaderTaskRepository,
  'recoverInterruptedWork' | 'setPassageOrganizationRunning' | 'savePassageOrganizationCandidate' |
  'setPassageOrganizationRetrying' | 'setPassageOrganizationFailure' | 'setPassageAnalysisRunning' |
  'savePassageAnalysis' | 'setPassageAnalysisFailureIfCurrent'>
  & Pick<ReaderLibraryRepository, 'getPassage' | 'watchBooks'>
  & Pick<ReaderSettingsRepository, 'watchPrompts' | 'watchRoles'>;

export async function registerReaderAiTasks(
  repository: ReaderAiTaskRepository,
  tasks: Pick<AiTaskRunner, 'register'>,
  getAi: (serviceId: string) => AiEngine | null,
): Promise<() => void> {
  await repository.recoverInterruptedWork();
  const removeOrganize = tasks.register(ORGANIZE_OPERATION, async (task, context) => {
    const payload = passageTaskPayload(task.payload);
    const passage = await repository.getPassage(payload.passageId);
    if (!passage || passage.sourceRevision !== payload.sourceRevision) return;
    if (passage.organizationStatus === 'interrupted' && passage.organizationError === USER_STOPPED_ORGANIZATION) return;
    const accepted = await repository.setPassageOrganizationRunning(passage.id, payload.sourceRevision);
    if (!accepted) return;
    try {
      const prompt = await promptForStage(repository, 'organize');
      const rendered = renderReaderPrompt(prompt, {
        book: null,
        passage,
        role: null,
        question: '',
        messages: [],
      });
      const ai = requireTaskAi(getAi, task);
      let resultText = '';
      try {
        const result = await ai.generate({
          messages: [
            { role: 'system', content: rendered.system },
            { role: 'user', content: rendered.user },
          ],
          responseFormat: 'json',
          temperature: 0.05,
        }, { signal: context.signal });
        resultText = result.text;
      } catch (genError) {
        if (context.signal.aborted || isAbortError(genError) || willRetryTask(genError, task)) {
          throw genError;
        }
        const fallbackResult = await ai.generate({
          messages: [
            { role: 'system', content: rendered.system },
            { role: 'user', content: rendered.user },
          ],
          temperature: 0.05,
        }, { signal: context.signal });
        resultText = fallbackResult.text;
      }
      const organized = parseOrganizedText(resultText);
      if (context.signal.aborted) return;
      // Keep the generated rewrite separate from the reader-visible source. The user
      // must review and apply it before any follow-up analysis can use the new text.
      const saved = await repository.savePassageOrganizationCandidate(
        passage.id, payload.sourceRevision, organized,
      );
      if (!saved) return;
    } catch (error) {
      if (willRetryTask(error, task)) {
        await repository.setPassageOrganizationRetrying(
          passage.id,
          payload.sourceRevision,
          retryMessage(error, task),
        );
      } else await repository.setPassageOrganizationFailure(
          passage.id,
          payload.sourceRevision,
          messageOf(error),
          context.signal.aborted || isAbortError(error),
        );
      throw error;
    }
  });
  const removeAnalysis = tasks.register(ANALYSIS_OPERATION, async (task, context) => {
    const payload = passageTaskPayload(task.payload);
    const passage = await repository.getPassage(payload.passageId);
    if (!passage) return;
    if (passage.analysisStatus === 'interrupted' && passage.analysisError === USER_STOPPED_ANALYSIS) return;
    if (!payload.useLatestSource && passage.sourceRevision !== payload.sourceRevision) return;
    if (payload.useLatestSource && passage.organizationStatus !== 'completed') {
      await repository.setPassageAnalysisFailureIfCurrent(passage.id, passage.sourceRevision, '整理未完成，分析没有开始');
      return;
    }
    const sourceRevision = passage.sourceRevision;
    const accepted = await repository.setPassageAnalysisRunning(passage.id, sourceRevision);
    if (!accepted) return;
    try {
      const [book, prompt, roles] = await Promise.all([
        readWatchedItem(repository.watchBooks.bind(repository), (item) => item.id === passage.bookId),
        promptForStage(repository, 'analysis'),
        readWatchedSnapshot(repository.watchRoles.bind(repository)),
      ]);
      const role = roles.find((candidate) => candidate.id === book?.roleId) ?? null;
      const rendered = renderReaderPrompt(prompt, { book, passage, role, question: '', messages: [] });
      const result = await requireTaskAi(getAi, task).generate({
        messages: [
          { role: 'system', content: rendered.system },
          { role: 'user', content: rendered.user },
        ],
        responseFormat: 'json',
        temperature: 0.25,
      }, { signal: context.signal });
      const analysis = parseReaderAnalysisResponse(result.text);
      await repository.savePassageAnalysis(passage.id, analysis.summary, analysis.questions, sourceRevision);
    } catch (error) {
      if (!willRetryTask(error, task)) await repository.setPassageAnalysisFailureIfCurrent(
        passage.id,
        sourceRevision,
        messageOf(error),
        context.signal.aborted || isAbortError(error),
      );
      throw error;
    }
  });
  return () => {
    removeOrganize();
    removeAnalysis();
  };
}

function requireTaskAi(getAi: (serviceId: string) => AiEngine | null, task: AiTask): AiEngine {
  const ai = getAi(task.serviceId);
  if (!ai) throw new AiEngineError('unconfigured', 'Reader 使用的 AI 服务不存在或已删除');
  return ai;
}

function passageTaskPayload(value: unknown): PassageTaskPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Reader 任务数据无效');
  const record = value as Record<string, unknown>;
  if (typeof record.passageId !== 'string' || !Number.isSafeInteger(record.sourceRevision)) throw new Error('Reader 任务数据无效');
  return {
    passageId: record.passageId,
    sourceRevision: Number(record.sourceRevision),
    ...(record.runAnalysisAfter === true ? { runAnalysisAfter: true } : {}),
    ...(record.useLatestSource === true ? { useLatestSource: true } : {}),
  };
}

async function promptForStage(repository: ReaderAiTaskRepository, stage: ReaderPrompt['stage']): Promise<ReaderPrompt> {
  const prompts = await readWatchedSnapshot(repository.watchPrompts.bind(repository));
  const prompt = prompts.find((candidate) => candidate.stage === stage);
  if (!prompt) throw new Error(`Reader ${stage} Prompt 不存在`);
  return prompt;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function willRetryTask(error: unknown, task: AiTask): boolean {
  return error instanceof AiEngineError
    && ['timeout', 'unavailable', 'rate-limited'].includes(error.code)
    && task.attemptCount < AI_TASK_MAX_AUTOMATIC_RETRIES;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'AI 请求已停止';
  return error instanceof Error && error.message ? error.message : 'AI 请求失败';
}

function retryMessage(error: unknown, task: AiTask): string {
  const attempt = task.attemptCount + 1;
  return `${messageOf(error).slice(0, 120)}，正在自动重试（第 ${attempt}/${AI_TASK_MAX_AUTOMATIC_RETRIES} 次）`;
}
