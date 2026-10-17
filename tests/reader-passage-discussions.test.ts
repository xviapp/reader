import { describe, expect, it } from 'vitest';

import type { ReaderDiscussion, ReaderPassage } from '@/modules/reader/domain/model';
import { readerDiscussionContextError } from '@/modules/reader/domain/rules';
import {
  EMPTY_READER_DISCUSSION_COMPOSER,
  normalizeReaderComposerIntent,
  readerDiscussionsForPassage,
  resolveReaderComposerIntent,
  searchReaderDiscussions,
} from '@/modules/reader/ui/discussion-flow';

const timestamp = '2026-08-29T12:00:00.000Z';

function discussion(id: string, passageId: string | null, lastMessageAt: string, deletedAt: string | null = null): ReaderDiscussion {
  return {
    id,
    title: id,
    bookId: 'book-1',
    passageId,
    folderId: null,
    unread: false,
    lastMessagePreview: '',
    lastMessageStatus: 'completed',
    latestAssistantMessageId: null,
    lastMessageAt,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt,
  };
}

function passage(): ReaderPassage {
  return {
    id: 'passage-1', bookId: 'book-1', title: '', pageLabel: '', imageUri: '',
    rawSourceText: '原文', sourceText: '原文', sourceRevision: 1, organizedSourceRevision: 0,
    ocrScript: 'auto', ocrBlocks: [], summary: '', suggestedQuestions: [], analysisStatus: 'idle',
    analysisError: null, organizationStatus: 'idle', organizationError: null,
    createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  };
}

describe('Reader passage discussion flow', () => {
  it('keeps only active discussions for a passage and sorts them by recent activity', () => {
    const result = readerDiscussionsForPassage([
      discussion('older', 'passage-1', '2026-08-29T10:00:00.000Z'),
      discussion('other', 'passage-2', '2026-08-29T13:00:00.000Z'),
      discussion('deleted', 'passage-1', '2026-08-29T14:00:00.000Z', timestamp),
      discussion('newer', 'passage-1', '2026-08-29T11:00:00.000Z'),
    ], 'passage-1');

    expect(result.map((item) => item.id)).toEqual(['newer', 'older']);
  });

  it('searches discussions by title and latest message without changing source order', () => {
    const titleMatch = { ...discussion('title', 'passage-1', timestamp), title: '量子力学路线' };
    const previewMatch = { ...discussion('preview', 'passage-1', timestamp), lastMessagePreview: '继续讨论线性代数' };
    const unrelated = discussion('unrelated', 'passage-1', timestamp);
    const discussions = [titleMatch, previewMatch, unrelated];

    expect(searchReaderDiscussions(discussions, ' 量子 ')).toEqual([titleMatch]);
    expect(searchReaderDiscussions(discussions, '线性代数')).toEqual([previewMatch]);
    expect(searchReaderDiscussions(discussions, '')).toBe(discussions);
  });

  it('appends, replaces or preserves an existing composer draft and consumes the intent once', () => {
    const intent = { id: 'intent-1', question: '新的追问' };
    const current = { text: '原有草稿', consumedIntentId: null };

    expect(resolveReaderComposerIntent(current, intent, 'append')).toEqual({
      text: '原有草稿\n\n新的追问', consumedIntentId: 'intent-1',
    });
    expect(resolveReaderComposerIntent(current, intent, 'replace')).toEqual({
      text: '新的追问', consumedIntentId: 'intent-1',
    });
    expect(resolveReaderComposerIntent(current, intent, 'cancel')).toEqual({
      text: '原有草稿', consumedIntentId: 'intent-1',
    });
  });

  it('validates route composer intents defensively', () => {
    expect(EMPTY_READER_DISCUSSION_COMPOSER).toEqual({ text: '', consumedIntentId: null });
    expect(normalizeReaderComposerIntent({ id: '', question: '问题' })).toBeNull();
    expect(normalizeReaderComposerIntent({ id: 'i-2', question: '问题' })).toEqual({ id: 'i-2', question: '问题' });
  });

  it('requires a passage discussion to use the passage owning book', () => {
    const p = passage();
    const passageMap = new Map([[p.id, p]]);
    expect(readerDiscussionContextError({ bookId: 'book-1', passageId: 'passage-1' }, passageMap)).toBeNull();
    expect(readerDiscussionContextError({ bookId: 'book-2', passageId: 'passage-1' }, passageMap)).toContain('所属书籍不一致');
    expect(readerDiscussionContextError({ bookId: 'book-1', passageId: 'passage-1' }, new Map())).toContain('不存在');
  });

  it('validates all passages in a multi-source discussion', () => {
    const p1 = passage();
    const p2 = { ...passage(), id: 'passage-2' };
    const p3 = { ...passage(), id: 'passage-3', bookId: 'book-2' };
    const allSameBook = new Map([[p1.id, p1], [p2.id, p2]]);
    const crossBook = new Map([[p1.id, p1], [p3.id, p3]]);
    expect(readerDiscussionContextError({ bookId: 'book-1', passageId: null, passageIds: [p1.id, p2.id] }, allSameBook)).toBeNull();
    expect(readerDiscussionContextError({ bookId: 'book-1', passageId: null, passageIds: [p1.id, p3.id] }, crossBook)).toContain('所属书籍不一致');
    expect(readerDiscussionContextError({ bookId: 'book-1', passageId: null, passageIds: [p1.id, 'missing'] }, allSameBook)).toContain('不存在');
    expect(readerDiscussionContextError({ bookId: null, passageId: null, passageIds: [] }, new Map())).toBeNull();
  });
});
