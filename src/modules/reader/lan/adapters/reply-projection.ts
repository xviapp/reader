import type { ReaderLiveReply, ReaderReplyEvent } from '../../application/reply-events';
import type { LanLiveReply, LanReplyEvent } from '../contracts';

export function projectLiveReply(reply: ReaderLiveReply): LanLiveReply {
  return {
    messageId: reply.messageId, discussionId: reply.discussionId,
    generationId: reply.generationId, version: reply.version, text: reply.text,
    state: reply.state, previewAvailable: reply.previewAvailable,
  };
}

export function projectReplyEvent(event: ReaderReplyEvent): LanReplyEvent {
  const identity = { messageId: event.messageId, discussionId: event.discussionId,
    generationId: event.generationId, version: event.version };
  return event.type === 'reply-delta'
    ? { ...identity, type: event.type, offset: event.offset, delta: event.delta }
    : { ...identity, type: event.type, state: event.state, previewAvailable: event.previewAvailable };
}
