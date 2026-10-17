import type { AiEngine } from '@/core/ai/ai-engine';
import type { AiTaskRunner } from '@/core/ai/ai-task-runner';
import type {
  ReaderDiscussion,
  ReaderDiscussionDraft,
  ReaderMessage,
  ReaderPassage,
  ReaderPrompt,
  ReaderRole,
  ReaderBook,
} from '../domain/model';
import { type ReaderBookPromptInput } from './reader-book-ai';
import type { ReaderDiscussionAiRepository } from './reader-discussion-ai';
import { createReaderActions } from './reader-actions';
import { registerReaderAiTasks as registerReaderAiTaskHandlers, type ReaderAiTaskRepository } from './reader-ai-tasks';
import type { ReaderPassageAiRepository } from './reader-passage-ai';
import { readerLiveReplies, type ReaderLiveReplies } from './reader-live-replies';

export type { ReaderBookPromptInput } from './reader-book-ai';
export { parseOrganizedText } from './reader-organization-result';

export interface ReaderAiContext {
  book: ReaderBook | null;
  passage: ReaderPassage | null;
  passages?: readonly ReaderPassage[];
  role: ReaderRole | null;
}

export type ReaderDiscussionContext = Omit<ReaderAiContext, 'passage'>;

type ReaderAiRepository = ReaderDiscussionAiRepository & ReaderPassageAiRepository;
type ReaderTaskSource = AiTaskRunner | null | (() => AiTaskRunner | null);

/**
 * Compatibility facade for the UI. The implementation is split by responsibility:
 * discussion replies, passage tasks, and book-specific prompts each live behind a
 * dedicated module.
 */
export class ReaderAiCoordinator {
  private readonly actions: ReturnType<typeof createReaderActions>;

  constructor(
    repository: ReaderAiRepository,
    getAi: () => AiEngine | null,
    tasks: ReaderTaskSource = null,
    getDefaultServiceId: () => string | null = () => null,
    liveReplies: ReaderLiveReplies = readerLiveReplies,
  ) {
    const getTasks = typeof tasks === 'function' ? tasks : () => tasks;
    this.actions = createReaderActions(repository, () => ({
      ai: getAi(),
      aiTasks: getTasks(),
      defaultAiServiceId: getDefaultServiceId(),
    }), liveReplies);
  }

  analyzePassage(passage: ReaderPassage): Promise<void> {
    return this.actions.passages.analyzePassage(passage);
  }

  organizePassage(passage: ReaderPassage, runAnalysisAfter = false): Promise<void> {
    return this.actions.passages.organizePassage(passage, runAnalysisAfter);
  }

  resumePassage(passage: ReaderPassage, operation: 'organize' | 'analysis'): Promise<void> {
    return this.actions.passages.resumePassage(passage, operation);
  }

  stopPassage(passageId: string): Promise<void> {
    return this.actions.passages.stopPassage(passageId);
  }

  trashBook(bookId: string): Promise<void> {
    return this.actions.passages.trashBook(bookId);
  }

  trashPassage(passageId: string): Promise<void> {
    return this.actions.passages.trashPassage(passageId);
  }

  trashDiscussion(discussionId: string): Promise<void> {
    return this.actions.discussions.trashDiscussion(discussionId);
  }

  createDiscussion(
    draft: ReaderDiscussionDraft,
    context: ReaderDiscussionContext,
    prompt: ReaderPrompt,
  ): Promise<string> {
    return this.actions.discussions.createDiscussion(draft, context, prompt);
  }

  sendFollowUp(
    discussion: ReaderDiscussion,
    question: string,
    context: ReaderAiContext,
    prompt: ReaderPrompt,
    messages: readonly ReaderMessage[],
    options?: { onUserMessageSaved?: () => void },
  ): Promise<void> {
    return this.actions.discussions.sendFollowUp(discussion, question, context, prompt, messages, options);
  }

  retryReply(
    discussion: ReaderDiscussion,
    answerId: string,
    question: string,
    context: ReaderAiContext,
    prompt: ReaderPrompt,
    messages: readonly ReaderMessage[],
  ): Promise<void> {
    return this.actions.discussions.retryReply(discussion, answerId, question, context, prompt, messages);
  }

  stop(id: string): void {
    this.actions.discussions.stop(id);
  }

  stopAll(): void {
    this.actions.discussions.stopAll();
  }

  generateBookCustomPrompt(input: ReaderBookPromptInput, signal?: AbortSignal): Promise<string> {
    return this.actions.books.generateBookCustomPrompt(input, signal);
  }
}

/** Runtime compatibility export; task registration is implemented by the task module. */
export function registerReaderAiTasks(
  repository: ReaderAiTaskRepository,
  tasks: Pick<AiTaskRunner, 'register'>,
  getAi: (serviceId: string) => AiEngine | null,
): Promise<() => void> {
  return registerReaderAiTaskHandlers(repository, tasks, getAi);
}
