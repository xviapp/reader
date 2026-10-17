/** Process-local generation state. Transport adapters own serialization. */
export interface ReaderLiveReply {
  messageId: string;
  discussionId: string;
  generationId: string | null;
  version: number;
  text: string;
  state: 'generating' | 'committing';
  previewAvailable: boolean;
}

export type ReaderReplyState = 'generating' | 'committing' | 'completed' | 'failed';

export type ReaderReplyEvent = {
  discussionId: string;
  messageId: string;
  generationId: string;
  version: number;
} & (
  | { type: 'reply-delta'; offset: number; delta: string }
  | { type: 'reply-state'; state: ReaderReplyState; previewAvailable: boolean }
);
