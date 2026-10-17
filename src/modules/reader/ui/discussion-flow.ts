import type { ReaderDiscussion } from '../domain/model';
import { readerDiscussionPassageIds } from '../domain/rules';

export interface ReaderComposerIntent {
  id: string;
  question: string;
}

export interface ReaderDiscussionComposerState {
  text: string;
  consumedIntentId: string | null;
}

export type ReaderComposerIntentResolution = 'append' | 'replace' | 'cancel';

export const EMPTY_READER_DISCUSSION_COMPOSER: ReaderDiscussionComposerState = {
  text: '',
  consumedIntentId: null,
};

export function readerDiscussionsForPassage(
  discussions: readonly ReaderDiscussion[],
  passageId: string,
): readonly ReaderDiscussion[] {
  return discussions
    .filter((discussion) => readerDiscussionPassageIds(discussion).includes(passageId) && discussion.deletedAt === null)
    .sort((left, right) => {
      const recent = timestampOf(right.lastMessageAt) - timestampOf(left.lastMessageAt);
      return recent || right.id.localeCompare(left.id);
    });
}

export function searchReaderDiscussions(
  discussions: readonly ReaderDiscussion[],
  query: string,
): readonly ReaderDiscussion[] {
  const normalized = query.trim().toLocaleLowerCase('zh-CN');
  if (!normalized) return discussions;
  return discussions.filter((discussion) => (
    `${discussion.title}\n${discussion.lastMessagePreview}`.toLocaleLowerCase('zh-CN').includes(normalized)
  ));
}

export function createReaderComposerIntent(question: string): ReaderComposerIntent {
  const value = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return { id: `reader-composer-${value}`, question: question.trim().slice(0, 100_000) };
}

export function resolveReaderComposerIntent(
  current: ReaderDiscussionComposerState,
  intent: ReaderComposerIntent,
  resolution: ReaderComposerIntentResolution,
): ReaderDiscussionComposerState {
  const question = intent.question.trim();
  let text = current.text;
  if (resolution === 'replace') text = question;
  else if (resolution === 'append' && question) {
    const existing = current.text.trimEnd();
    text = existing ? `${existing}\n\n${question}` : question;
  }
  return { text: text.slice(0, 100_000), consumedIntentId: intent.id };
}

export function normalizeReaderComposerIntent(value: unknown): ReaderComposerIntent | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.question !== 'string') return null;
  const id = value.id.slice(0, 300);
  if (!id) return null;
  return { id, question: value.question.slice(0, 100_000) };
}

function timestampOf(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
