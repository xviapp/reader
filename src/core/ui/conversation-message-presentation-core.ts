export type ConversationMessageRole = 'user' | 'assistant' | 'system';

export const CONVERSATION_COLLAPSE_MIN_HEIGHT = 168;

export function conversationMessageCanCollapse(
  contentHeight: number,
  collapsed: boolean,
): boolean {
  if (collapsed) return true;
  return Number.isFinite(contentHeight) && contentHeight >= CONVERSATION_COLLAPSE_MIN_HEIGHT;
}

export function conversationMessageShowsSpeaker(role: ConversationMessageRole): boolean {
  return role !== 'user';
}
