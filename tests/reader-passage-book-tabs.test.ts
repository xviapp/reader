import { describe, expect, it } from 'vitest';

import {
  parseReaderAnalysisResponse,
  READER_ANALYSIS_OUTPUT_CONTRACT,
} from '@/modules/reader/application/reader-analysis-result';
import { renderReaderPrompt } from '@/modules/reader/application/prompt-renderer';
import { normalizeReaderAnalysisSummary } from '@/modules/reader/domain/analysis';
import type {
  ReaderDiscussion,
  ReaderMessage,
  ReaderPassageIndex,
  ReaderPrompt,
} from '@/modules/reader/domain/model';
import { passageDisplayTitle, passageLocationLabel } from '@/modules/reader/domain/rules';
import { readerBookContent } from '@/modules/reader/ui/book-content-model';
import { normalizeReaderRoute, shouldShowReaderPrimaryPane } from '@/modules/reader/ui/navigation';
import { splitPassageSummaryAtLines } from '@/modules/reader/ui/passage-summary-layout';

const timestamp = '2026-08-29T12:00:00.000Z';

describe('Reader passage analysis contract', () => {
  it('normalizes short plain-text summaries and counts Unicode characters', () => {
    expect(normalizeReaderAnalysisSummary('  第一行 \r\n 第二行  ')).toBe('第一行\n第二行');
    expect(normalizeReaderAnalysisSummary('摘'.repeat(180))).toHaveLength(180);
    expect(() => normalizeReaderAnalysisSummary('摘'.repeat(181))).toThrow('超过 180 字');
  });

  it.each([
    '# 标题',
    '- 列表项',
    '*斜体*',
    '**粗体**',
    '[链接](https://example.com)',
    '$x^2$',
    '| 表格 |',
  ])('rejects Markdown summary syntax: %s', (value) => {
    expect(() => normalizeReaderAnalysisSummary(value)).toThrow('必须是纯文本');
  });

  it('accepts only three to five plain-text questions', () => {
    expect(parseReaderAnalysisResponse('```json\n{"summary":"短摘要","questions":["问题一？","问题二？","问题三？"]}\n```')).toEqual({
      summary: '短摘要',
      questions: ['问题一？', '问题二？', '问题三？'],
    });
    expect(() => parseReaderAnalysisResponse('{"summary":"短摘要","questions":["问题一？","问题二？"]}')).toThrow('3 到 5');
    expect(() => parseReaderAnalysisResponse('{"summary":"短摘要","questions":["一","二","三","四","五","六"]}')).toThrow('3 到 5');
    expect(() => parseReaderAnalysisResponse('{"summary":"短摘要","questions":["问题一？","- 问题二","问题三？"]}')).toThrow('必须是纯文本');
  });

  it('appends the host contract after a custom analysis prompt', () => {
    const prompt: ReaderPrompt = {
      id: 'analysis-custom',
      stage: 'analysis',
      systemTemplate: '自定义模板要求输出 Markdown。',
      userTemplate: '{{passage_text}}',
      includeBook: false,
      includeSource: true,
      includeSummary: false,
      historyLimit: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const rendered = renderReaderPrompt(prompt, {
      book: null,
      passage: null,
      role: null,
      question: '',
      messages: [],
    });

    expect(rendered.system.endsWith(READER_ANALYSIS_OUTPUT_CONTRACT)).toBe(true);
    expect(rendered.system.indexOf('自定义模板')).toBeLessThan(rendered.system.indexOf('调用方强制输出契约'));
  });
});

describe('Reader passage summary layout', () => {
  it('splits measured lines without losing or duplicating text', () => {
    const value = '第一行第二行第三行第四行';
    const split = splitPassageSummaryAtLines(value, ['第一行', '第二行', '第三行', '第四行'], 2);

    expect(split).toEqual({ lead: '第一行第二行', remainder: '第三行第四行' });
    expect(split.lead + split.remainder).toBe(value);
  });

  it('keeps a summary entirely beside the image when it fits', () => {
    expect(splitPassageSummaryAtLines('一条短摘要', ['一条短摘要'], 4)).toEqual({
      lead: '一条短摘要',
      remainder: '',
    });
  });
});

describe('Reader passage location labels', () => {
  it('formats numeric pages without rewriting named locations', () => {
    expect(passageLocationLabel(' 28 ')).toBe('第 28 页');
    expect(passageLocationLabel('第三章')).toBe('第三章');
    expect(passageDisplayTitle('', '结语', '正文')).toBe('结语');
  });
});

describe('Reader book content', () => {
  it('keeps active book content in repository order and counts deleted rows', () => {
    const passages = [
      passage('passage-new', 'book-1'),
      passage('passage-deleted', 'book-1', timestamp),
      passage('passage-other', 'book-2'),
      passage('passage-old', 'book-1'),
    ];
    const discussions = [
      discussion('discussion-new', 'book-1', null),
      discussion('discussion-passage', 'book-1', 'passage-old'),
      discussion('discussion-deleted', 'book-1', null, timestamp),
      discussion('discussion-other', 'book-2', null),
    ];
    const favorites = [
      message('favorite-new', 'discussion-new'),
      message('favorite-passage', 'discussion-passage'),
      message('favorite-user', 'discussion-new', { role: 'user' }),
      message('favorite-pending', 'discussion-new', { status: 'pending' }),
      message('favorite-deleted-discussion', 'discussion-deleted'),
      message('favorite-other', 'discussion-other'),
    ];

    const content = readerBookContent('book-1', passages, discussions, favorites);

    expect(content.passages.map((item) => item.id)).toEqual(['passage-new', 'passage-old']);
    expect(content.discussions.map((item) => item.id)).toEqual(['discussion-new', 'discussion-passage']);
    expect(content.favorites.map((item) => item.id)).toEqual(['favorite-new', 'favorite-passage']);
    expect(content.deletedCount).toBe(2);
  });
});

describe('Reader book route', () => {
  it('restores a selected book tab and defaults older state to passages', () => {
    expect(normalizeReaderRoute({ name: 'book', bookId: 'book-1', tab: 'favorites' })).toEqual({
      name: 'book',
      bookId: 'book-1',
      tab: 'favorites',
    });
    expect(normalizeReaderRoute({ name: 'book', bookId: 'book-1' })).toEqual({
      name: 'book',
      bookId: 'book-1',
      tab: 'passages',
    });
  });
});

describe('Reader passage route', () => {
  it('restores a selected passage tab and defaults older state to questions', () => {
    expect(normalizeReaderRoute({ name: 'passage', passageId: 'passage-1', tab: 'discussions' })).toEqual({
      name: 'passage',
      passageId: 'passage-1',
      tab: 'discussions',
    });
    expect(normalizeReaderRoute({ name: 'passage', passageId: 'passage-1' })).toEqual({
      name: 'passage',
      passageId: 'passage-1',
      tab: 'questions',
    });
  });
});

describe('Reader focused-reading layout', () => {
  it('gives focused reading the full surface on wide layouts', () => {
    expect(shouldShowReaderPrimaryPane({ name: 'discussion-reader', discussionId: 'discussion-1', messageId: 'message-1' }, true)).toBe(false);
  });
});

function passage(id: string, bookId: string, deletedAt: string | null = null): ReaderPassageIndex {
  return {
    id,
    bookId,
    title: id,
    pageLabel: '',
    imageUri: '',
    sourcePreview: '原文',
    summaryPreview: '摘要',
    sourceRevision: 1,
    analysisStatus: 'completed',
    analysisError: null,
    organizationStatus: 'completed',
    organizationError: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt,
  };
}

function discussion(id: string, bookId: string, passageId: string | null, deletedAt: string | null = null): ReaderDiscussion {
  return {
    id,
    title: id,
    bookId,
    passageId,
    folderId: null,
    unread: false,
    lastMessagePreview: '',
    lastMessageStatus: 'completed',
    latestAssistantMessageId: null,
    lastMessageAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt,
  };
}

function message(
  id: string,
  discussionId: string,
  overrides: Partial<Pick<ReaderMessage, 'role' | 'status' | 'favorite' | 'deletedAt'>> = {},
): ReaderMessage {
  return {
    id,
    discussionId,
    role: overrides.role ?? 'assistant',
    content: id,
    status: overrides.status ?? 'completed',
    favorite: overrides.favorite ?? true,
    collapsed: false,
    errorMessage: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: overrides.deletedAt ?? null,
  };
}
