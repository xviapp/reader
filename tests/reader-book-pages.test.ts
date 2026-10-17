import { describe, expect, it } from 'vitest';

import type { ReaderBookDraft } from '@/modules/reader/domain/model';
import { normalizeReaderBook, readerBookProgress, readerProgressEntry, readerStatusForPages } from '@/modules/reader/domain/rules';

const book = (pageCount: number, pagesRead: number, progress = 77): ReaderBookDraft => ({
  title: '活着', authors: [], coverUri: '', isbn: '', publisher: '', publishedAt: '', summary: '', note: '',
  status: 'reading', progress, pageCount, pagesRead, roleId: '', customPrompt: '',
});

describe('book pages and progress', () => {
  it('derives progress from pages read and ignores any entered progress', () => {
    expect(normalizeReaderBook(book(200, 50))).toMatchObject({ pageCount: 200, pagesRead: 50, progress: 25 });
    expect(readerBookProgress(book(200, 50))).toBe(25);
  });

  it('shows no progress while the page count or pages read is unknown', () => {
    expect(normalizeReaderBook(book(0, 50))).toMatchObject({ pageCount: 0, pagesRead: 50, progress: 0 });
    expect(readerBookProgress(book(0, 50))).toBeNull();
    expect(readerBookProgress(book(300, 0))).toBeNull();
  });

  it('keeps pages within the book and shows a started book as at least 1%', () => {
    expect(normalizeReaderBook(book(100, 140))).toMatchObject({ pagesRead: 100, progress: 100 });
    expect(readerBookProgress(book(1000, 1))).toBe(1);
    expect(normalizeReaderBook(book(-3, Number.NaN))).toMatchObject({ pageCount: 0, pagesRead: 0, progress: 0 });
  });

  it('keeps the pages already read when the page is left blank', () => {
    expect(readerProgressEntry(book(256, 120), '')).toEqual({ ok: true, pageCount: 256, pagesRead: 120, page: null });
    expect(readerProgressEntry(book(256, 120), ' 130 ')).toEqual({ ok: true, pageCount: 256, pagesRead: 130, page: 130 });
    expect(readerProgressEntry(book(256, 120), '0')).toMatchObject({ ok: true, pagesRead: 0 });
  });

  it('takes the page count while it is unknown and ignores it once known', () => {
    expect(readerProgressEntry(book(0, 0), '40', '320')).toEqual({ ok: true, pageCount: 320, pagesRead: 40, page: 40 });
    expect(readerProgressEntry(book(0, 0), '40', '')).toMatchObject({ ok: true, pageCount: 0 });
    expect(readerProgressEntry(book(256, 0), '40', '999')).toMatchObject({ ok: true, pageCount: 256 });
    expect(readerProgressEntry(book(0, 0), '', '0')).toEqual({ ok: false, error: '全书页数请填写正整数，或留空。' });
  });

  it('rejects pages that are not whole numbers or beyond the book', () => {
    expect(readerProgressEntry(book(256, 0), '12.5')).toEqual({ ok: false, error: '页码请填写整数，或留空。' });
    expect(readerProgressEntry(book(256, 0), '-1')).toEqual({ ok: false, error: '页码请填写整数，或留空。' });
    expect(readerProgressEntry(book(256, 0), '260')).toEqual({ ok: false, error: '超过全书页数（256）' });
    expect(readerProgressEntry(book(0, 0), '260', '256')).toEqual({ ok: false, error: '超过全书页数（256）' });
  });

  it('suggests a status from the pages read', () => {
    expect(readerStatusForPages('reading', 256, 256)).toBe('finished');
    expect(readerStatusForPages('unread', 10, 256)).toBe('reading');
    expect(readerStatusForPages('unread', 10, 0)).toBe('reading');
    expect(readerStatusForPages('finished', 100, 256)).toBe('reading');
    expect(readerStatusForPages('finished', 100, 0)).toBe('finished');
    expect(readerStatusForPages('unread', 0, 256)).toBe('unread');
    expect(readerStatusForPages('reading', 0, 0)).toBe('reading');
  });
});
