import { AiEngineError } from '@/core/ai/ai-engine';
import type { AiTaskRunner } from '@/core/ai/ai-task-runner';
import type { ReaderPassage } from '../domain/model';
import type { ReaderTaskRepository, ReaderTrashRepository } from './ports';
import { ORGANIZE_OPERATION, ANALYSIS_OPERATION, USER_STOPPED_ORGANIZATION, USER_STOPPED_ANALYSIS, type PassageTaskPayload } from './passage-task';

export type ReaderTaskAdmission = Pick<AiTaskRunner, 'admit'>;
export type ReaderPassageAiRepository = Pick<ReaderTaskRepository, 'admitPassageWork' | 'interruptPassageWork'>
  & Pick<ReaderTrashRepository, 'listBookPassageIds' | 'trashBook' | 'trashPassage'>;

export class ReaderPassageAi {
  constructor(
    private readonly repository: ReaderPassageAiRepository,
    private readonly getTasks: () => ReaderTaskAdmission | null,
    private readonly getDefaultServiceId: () => string | null,
  ) {}

  async analyzePassage(
    passage: ReaderPassage,
  ): Promise<void> {
    await this.enqueueAnalysis(passage);
  }

  async organizePassage(passage: ReaderPassage, runAnalysisAfter = false): Promise<void> {
    const tasks = this.getTasks();
    if (!tasks) throw new Error('Reader 后台任务尚未准备好');
    const serviceId = this.requireDefaultServiceId();
    await tasks.admit(async ({ transaction, enqueue }) => {
      const accepted = await this.repository.admitPassageWork(
        passage.id, passage.sourceRevision, 'organize', transaction,
      );
      if (!accepted) throw new Error('摘录已经变化或已有 AI 任务正在进行');
      await enqueue({
        subjectId: passage.id,
        operation: ORGANIZE_OPERATION,
        idempotencyKey: `organize:${passage.id}:${passage.sourceRevision}:${Date.now()}`,
        serviceId,
        payload: { passageId: passage.id, sourceRevision: passage.sourceRevision, runAnalysisAfter } satisfies PassageTaskPayload,
      });
    });
  }

  async resumePassage(passage: ReaderPassage, operation: 'organize' | 'analysis'): Promise<void> {
    if (operation === 'organize') await this.organizePassage(passage);
    else await this.enqueueAnalysis(passage);
  }

  async stopPassage(passageId: string): Promise<void> {
    const tasks = this.getTasks();
    if (!tasks) {
      await this.repository.interruptPassageWork(passageId, USER_STOPPED_ORGANIZATION, USER_STOPPED_ANALYSIS);
      return;
    }
    await tasks.admit(async ({ transaction, cancelSubjects }) => {
      await cancelSubjects([passageId], '用户停止了 Reader 任务');
      await this.repository.interruptPassageWork(
        passageId,
        USER_STOPPED_ORGANIZATION,
        USER_STOPPED_ANALYSIS,
        transaction,
      );
    });
  }

  async trashBook(bookId: string): Promise<void> {
    const tasks = this.getTasks();
    if (!tasks) {
      await this.repository.trashBook(bookId);
      return;
    }
    await tasks.admit(async ({ transaction, cancelSubjects }) => {
      const passageIds = await this.repository.listBookPassageIds(bookId, transaction);
      await cancelSubjects(passageIds, '书籍已移入回收站');
      await this.repository.trashBook(bookId, transaction);
    });
  }

  async trashPassage(passageId: string): Promise<void> {
    const tasks = this.getTasks();
    if (!tasks) {
      await this.repository.trashPassage(passageId);
      return;
    }
    await tasks.admit(async ({ transaction, cancelSubjects }) => {
      await cancelSubjects([passageId], '摘录已移入回收站');
      await this.repository.trashPassage(passageId, transaction);
    });
  }

  private requireDefaultServiceId(): string {
    const serviceId = this.getDefaultServiceId();
    if (!serviceId) throw new AiEngineError('unconfigured', 'AI 未配置');
    return serviceId;
  }

  private async enqueueAnalysis(passage: ReaderPassage): Promise<void> {
    const tasks = this.getTasks();
    if (!tasks) throw new Error('Reader 后台任务尚未准备好');
    const serviceId = this.requireDefaultServiceId();
    await tasks.admit(async ({ transaction, enqueue }) => {
      const accepted = await this.repository.admitPassageWork(
        passage.id, passage.sourceRevision, 'analysis', transaction,
      );
      if (!accepted) throw new Error('摘录已经变化或已有 AI 任务正在进行');
      await enqueue({
        subjectId: passage.id,
        operation: ANALYSIS_OPERATION,
        idempotencyKey: `analysis:${passage.id}:${passage.sourceRevision}:${Date.now()}`,
        serviceId,
        payload: { passageId: passage.id, sourceRevision: passage.sourceRevision } satisfies PassageTaskPayload,
      });
    });
  }

}
