import type { AiEngine } from '@/core/ai/ai-engine';
import type { ReaderBook, ReaderDiscussion, ReaderDiscussionDraft, ReaderMessage, ReaderPassage, ReaderPrompt, ReaderRole } from '../domain/model';
import { assertReaderDiscussionContext } from '../domain/rules';
import type { ReaderDiscussionRepository, ReaderLibraryRepository, ReaderTrashRepository } from './ports';
import { renderReaderPrompt } from './prompt-renderer';
import { readerLiveReplies, type ReaderLiveReplies } from './reader-live-replies';

export type ReaderDiscussionAiRepository = Pick<ReaderDiscussionRepository,
  'createDiscussion' | 'appendMessage' | 'prepareMessageRetry' | 'completeMessage' | 'failMessage'>
  & Partial<Pick<ReaderDiscussionRepository, 'recordMessageSources'>>
  & Pick<ReaderLibraryRepository, 'getPassage'> & Pick<ReaderTrashRepository, 'trashDiscussion'>;

interface ReaderAiContext {
  book: ReaderBook | null;
  passage: ReaderPassage | null;
  passages?: readonly ReaderPassage[];
  role: ReaderRole | null;
}

type ReaderDiscussionContext = Omit<ReaderAiContext, 'passage'>;

export class ReaderDiscussionAi {
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly repository: ReaderDiscussionAiRepository,
    private readonly getAi: () => AiEngine | null,
    private readonly liveReplies: ReaderLiveReplies = readerLiveReplies,
  ) {}

  async trashDiscussion(discussionId: string): Promise<void> {
    this.stop(`discussion:${discussionId}`);
    await this.repository.trashDiscussion(discussionId);
  }

  async createDiscussion(
    draft: ReaderDiscussionDraft,
    context: ReaderDiscussionContext,
    prompt: ReaderPrompt,
  ): Promise<string> {
    const sourceIds = draft.passageIds?.length
      ? draft.passageIds
      : draft.passageId ? [draft.passageId] : [];
    const passages = (await Promise.all(sourceIds.map((id) => this.repository.getPassage(id)))).filter((item): item is ReaderPassage => Boolean(item));
    if (passages.length !== sourceIds.length) throw new Error('关联的摘录不存在或已在回收站');
    assertReaderDiscussionContext(draft, new Map(passages.map((p) => [p.id, p])));
    assertDiscussionSourceBudget(passages, prompt);
    const discussionId = await this.repository.createDiscussion(draft);
    void this.generateReply(discussionId, { ...context, passage: passages[0] ?? null, passages }, prompt, [], draft.openingMessage).catch(() => undefined);
    return discussionId;
  }

  async sendFollowUp(
    discussion: ReaderDiscussion,
    question: string,
    context: ReaderAiContext,
    prompt: ReaderPrompt,
    messages: readonly ReaderMessage[],
    options?: { onUserMessageSaved?: () => void },
  ): Promise<void> {
    const normalized = question.trim();
    if (!normalized) throw new Error('消息不能为空');
    assertDiscussionSourceBudget(context.passages?.length ? context.passages : context.passage ? [context.passage] : [], prompt);
    const sourcePassages = context.passages?.length ? context.passages : context.passage ? [context.passage] : [];
    const userMessageId = await this.repository.appendMessage(discussion.id, 'user', normalized, 'completed');
    await this.repository.recordMessageSources?.(userMessageId, sourcePassages.map((passage) => ({ passageId: passage.id, sourceRevision: passage.sourceRevision })));
    options?.onUserMessageSaved?.();
    await this.generateReply(discussion.id, context, prompt, messages, normalized);
  }

  retryReply(
    discussion: ReaderDiscussion,
    answerId: string,
    question: string,
    context: ReaderAiContext,
    prompt: ReaderPrompt,
    messages: readonly ReaderMessage[],
  ): Promise<void> {
    const normalized = question.trim();
    if (!normalized) return Promise.reject(new Error('找不到这条回答对应的问题'));
    return this.generateReply(discussion.id, context, prompt, messages, normalized, answerId);
  }

  stop(id: string): void {
    this.active.get(id)?.abort();
  }

  stopAll(): void {
    for (const controller of this.active.values()) controller.abort();
  }

  private async generateReply(
    discussionId: string,
    context: ReaderAiContext,
    prompt: ReaderPrompt,
    messages: readonly ReaderMessage[],
    question: string,
    answerId?: string,
  ): Promise<void> {
    const key = `discussion:${discussionId}`;
    const controller = this.start(key);
    let targetId = answerId ?? null;
    let generationId: string | null = null;
    try {
      assertDiscussionSourceBudget(context.passages?.length ? context.passages : context.passage ? [context.passage] : [], prompt);
      if (targetId) await this.repository.prepareMessageRetry(targetId);
      else targetId = await this.repository.appendMessage(discussionId, 'assistant', '', 'pending');
      if (this.active.get(key) !== controller || controller.signal.aborted) throw new Error('回答已停止');
      const messageId = targetId;
      generationId = this.liveReplies.start(discussionId, messageId);
      const sourcePassages = context.passages?.length ? context.passages : context.passage ? [context.passage] : [];
      await this.repository.recordMessageSources?.(messageId, sourcePassages.map((passage) => ({ passageId: passage.id, sourceRevision: passage.sourceRevision })));
      const rendered = renderReaderPrompt(prompt, {
        ...context,
        question,
        messages,
      });
      const result = await this.requireAi().generate(
        {
          messages: [
            { role: 'system', content: rendered.system },
            ...rendered.history,
            { role: 'user', content: rendered.user },
          ],
          temperature: 0.45,
        },
        { signal: controller.signal, onDelta: (delta) => {
          if (targetId && generationId && this.active.get(key) === controller && !controller.signal.aborted) {
            this.liveReplies.append(targetId, generationId, delta);
          }
        } },
      );
      // A stopped generation may finish late after the user has already retried.
      // Only the current generation is allowed to write the reused message row.
      if (this.active.get(key) !== controller) return;
      if (controller.signal.aborted) throw new Error('回答已停止');
      if (!targetId) throw new Error('回答记录创建失败');
      if (generationId) this.liveReplies.committing(targetId, generationId);
      await this.repository.completeMessage(targetId, result.text);
      if (generationId) this.liveReplies.finish(targetId, generationId, 'completed');
    } catch (error) {
      if (targetId && this.active.get(key) === controller) {
        await this.repository.failMessage(targetId, messageOf(error));
        if (generationId) this.liveReplies.finish(targetId, generationId, 'failed');
      }
      throw error;
    } finally {
      if (targetId && generationId) this.liveReplies.finish(targetId, generationId, 'failed');
      this.finish(key, controller);
    }
  }

  private requireAi(): AiEngine {
    const ai = this.getAi();
    if (!ai) throw new Error('AI 未配置');
    return ai;
  }

  private start(key: string): AbortController {
    this.active.get(key)?.abort();
    const controller = new AbortController();
    this.active.set(key, controller);
    return controller;
  }

  private finish(key: string, controller: AbortController): void {
    if (this.active.get(key) === controller) this.active.delete(key);
  }
}

function assertDiscussionSourceBudget(passages: readonly ReaderPassage[], prompt: ReaderPrompt): void {
  if (!prompt.includeSource) return;
  const sourceLength = passages.reduce((total, passage) => total + passage.sourceText.length + passage.rawSourceText.length, 0);
  if (sourceLength > 100_000) throw new Error('所选摘录内容较长，请减少关联摘录或先整理原文后再试');
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'AI 请求已停止';
  return error instanceof Error && error.message ? error.message : 'AI 请求失败';
}
