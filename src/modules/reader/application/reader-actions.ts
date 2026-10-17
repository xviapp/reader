import type { AiEngine } from '@/core/ai/ai-engine';
import type { ReaderDiscussionAiRepository } from './reader-discussion-ai';
import type { ReaderPassageAiRepository, ReaderTaskAdmission } from './reader-passage-ai';
import { ReaderDiscussionAi } from './reader-discussion-ai';
import { ReaderPassageAi } from './reader-passage-ai';
import { ReaderBookAi } from './reader-book-ai';
import { readerLiveReplies, type ReaderLiveReplies } from './reader-live-replies';

export interface ReaderAiAccess {
  ai: AiEngine | null;
  aiTasks: ReaderTaskAdmission | null;
  defaultAiServiceId: string | null;
}

export function createReaderActions(
  repository: ReaderDiscussionAiRepository & ReaderPassageAiRepository,
  current: () => ReaderAiAccess,
  liveReplies: ReaderLiveReplies = readerLiveReplies,
) {
  return {
    discussions: new ReaderDiscussionAi(repository, () => current().ai, liveReplies),
    passages: new ReaderPassageAi(repository, () => current().aiTasks, () => current().defaultAiServiceId),
    books: new ReaderBookAi(() => current().ai),
  };
}
