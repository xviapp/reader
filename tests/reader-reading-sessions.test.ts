import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it, vi } from 'vitest';

import type { LocalDatabase, SqlMutationResult, SqlWriteContext } from '@/core/data/database-contract';
import { renderReaderBookMarkdown } from '@/modules/reader/application/reader-export';
import { LocalReaderRepository } from '@/modules/reader/data/reader-repository';
import type { ReaderBook, ReaderBookDraft, ReaderReadingSession, ReaderReadingSummary } from '@/modules/reader/domain/model';
import { readerReadingDays, readerReadingDuration, readerReadingStats, readerReadingSummaryLabel, readerClockAfter, readerDailyReading, readerManualSessionEntry, readerMinutesUntilClock, readerReadingSpeed, readerRemainingMs, readerSessionEditEntry, readerSessionMinutesEntry, readerSessionPagesLabel } from '@/modules/reader/domain/rules';
import { normalizeReaderRoute } from '@/modules/reader/ui/navigation';
import { READER_DATABASE_SCHEMA } from '@/runtime/reader-database-schema';

// The export renders Markdown without touching files; only its packaging needs Expo.
vi.mock('expo-file-system', () => ({ File: class {}, Paths: {} }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: async () => false, shareAsync: async () => undefined }));

const timestamp = '2026-10-01T00:00:00.000Z';
const draft: ReaderBookDraft = {
  title: '活着', authors: ['余华'], coverUri: '', isbn: '', publisher: '', publishedAt: '', summary: '', note: '',
  status: 'reading', progress: 0, pageCount: 200, pagesRead: 50, roleId: 'reader-role-general', customPrompt: '',
};

async function repositoryWithBook() {
  const repository = new LocalReaderRepository(createDatabase(), 'local', () => new Date(timestamp));
  await repository.ensureDefaults();
  return { repository, bookId: await repository.createBook(draft) };
}

function summaryOf(repository: LocalReaderRepository, bookId: string): ReaderReadingSummary {
  let summary: ReaderReadingSummary | null = null;
  repository.watchReadingSummary(bookId, (value) => { summary = value; }, (error) => { throw error; });
  if (!summary) throw new Error('no summary');
  return summary;
}

describe('reading sessions kept with the book', () => {
  it('records sessions and sums them per book', async () => {
    const { repository, bookId } = await repositoryWithBook();
    expect(summaryOf(repository, bookId)).toEqual({ sessionCount: 0, totalMs: 0, lastReadAt: null });
    await repository.recordReadingSession(bookId, { startedAt: '2026-09-30T10:00:00.000Z', endedAt: '2026-09-30T10:25:00.000Z', startPage: 50, endPage: 72 });
    await repository.recordReadingSession(bookId, { startedAt: '2026-10-01T08:00:00.000Z', endedAt: '2026-10-01T09:10:00.000Z', startPage: 72, endPage: null });
    expect(summaryOf(repository, bookId)).toEqual({ sessionCount: 2, totalMs: 95 * 60_000, lastReadAt: '2026-10-01T09:10:00.000Z' });
    let listed: readonly ReaderReadingSession[] = [];
    repository.watchReadingSessions(bookId, (items) => { listed = items; }, (error) => { throw error; });
    expect(listed.map((item) => [item.startedAt, item.durationMs, item.startPage, item.endPage])).toEqual([
      ['2026-10-01T08:00:00.000Z', 70 * 60_000, 72, null],
      ['2026-09-30T10:00:00.000Z', 25 * 60_000, 50, 72],
    ]);
    await expect(repository.recordReadingSession(bookId, { startedAt: '2026-10-01T09:00:00.000Z', endedAt: '2026-10-01T08:00:00.000Z', startPage: null, endPage: null })).rejects.toThrow('阅读时间无效');
    await expect(repository.recordReadingSession('missing', { startedAt: timestamp, endedAt: timestamp, startPage: null, endPage: null })).rejects.toThrow('找不到这本书');
  });

  it('corrects and deletes a kept session', async () => {
    const { repository, bookId } = await repositoryWithBook();
    const id = await repository.recordReadingSession(bookId, { startedAt: '2026-09-30T21:00:00.000Z', endedAt: '2026-10-01T07:00:00.000Z', startPage: 50, endPage: 72 });
    await repository.updateReadingSession(id, { startedAt: '2026-09-30T21:00:00.000Z', endedAt: '2026-09-30T21:40:00.000Z', startPage: 50, endPage: 80 });
    let listed: readonly ReaderReadingSession[] = [];
    repository.watchReadingSessions(bookId, (items) => { listed = items; }, (error) => { throw error; });
    expect(listed).toEqual([expect.objectContaining({ id, durationMs: 40 * 60_000, endedAt: '2026-09-30T21:40:00.000Z', endPage: 80 })]);
    await expect(repository.updateReadingSession('missing', { startedAt: timestamp, endedAt: timestamp, startPage: null, endPage: null })).rejects.toThrow('找不到这条阅读记录');
    await repository.deleteReadingSession(id);
    expect(summaryOf(repository, bookId).sessionCount).toBe(0);
  });

  it('keeps sessions through the trash and removes them with the book', async () => {
    const { repository, bookId } = await repositoryWithBook();
    await repository.trashBook(bookId);
    // A timer can still be ending while its book sits in the trash.
    await repository.recordReadingSession(bookId, { startedAt: '2026-09-30T10:00:00.000Z', endedAt: '2026-09-30T10:05:00.000Z', startPage: null, endPage: null });
    await repository.restoreBook(bookId);
    expect(summaryOf(repository, bookId).sessionCount).toBe(1);
    await repository.trashBook(bookId);
    await repository.deleteBookPermanently(bookId);
    expect(summaryOf(repository, bookId).sessionCount).toBe(0);
  });

  it('round-trips sessions and page counts through a backup, and restores older backups without sessions', async () => {
    const { repository, bookId } = await repositoryWithBook();
    await repository.recordReadingSession(bookId, { startedAt: '2026-09-30T10:00:00.000Z', endedAt: '2026-09-30T10:25:00.000Z', startPage: 50, endPage: 72 });
    const snapshot = await repository.createBackupSnapshot();
    expect(snapshot.books[0]).toMatchObject({ pageCount: 200, pagesRead: 50, progress: 25 });
    expect(snapshot.readingSessions).toEqual([expect.objectContaining({ bookId, durationMs: 25 * 60_000, startPage: 50, endPage: 72 })]);

    const target = new LocalReaderRepository(createDatabase(), 'local', () => new Date(timestamp));
    await target.ensureDefaults();
    await target.restoreBackupSnapshot(snapshot);
    const restored = await target.createBackupSnapshot();
    expect(restored.books).toEqual(snapshot.books);
    expect(restored.readingSessions).toEqual(snapshot.readingSessions);

    const { readingSessions: _dropped, ...older } = snapshot;
    await target.replaceBackupSnapshot(older);
    expect((await target.createBackupSnapshot()).readingSessions).toEqual([]);
  });

  it('reads page counts on the shelf, so saving the progress sheet keeps them', async () => {
    const { repository } = await repositoryWithBook();
    let books: readonly ReaderBook[] = [];
    repository.watchBooks(false, (items) => { books = items; }, (error) => { throw error; });
    expect(books[0]).toMatchObject({ pageCount: 200, pagesRead: 50 });
  });
});

describe('reading time labels', () => {
  it('shows minutes below an hour and hours with minutes after', () => {
    expect(readerReadingDuration(59_999)).toBe('0 分钟');
    expect(readerReadingDuration(25 * 60_000)).toBe('25 分钟');
    expect(readerReadingDuration(120 * 60_000)).toBe('2 小时');
    expect(readerReadingDuration(95 * 60_000)).toBe('1 小时 35 分');
  });

  it('summarizes kept sessions, with the year only when it differs', () => {
    const now = new Date(2026, 9, 1);
    expect(readerReadingSummaryLabel({ sessionCount: 0, totalMs: 0, lastReadAt: null }, now)).toBeNull();
    expect(readerReadingSummaryLabel({ sessionCount: 3, totalMs: 95 * 60_000, lastReadAt: new Date(2026, 8, 30, 12).toISOString() }, now)).toBe('累计 1 小时 35 分 · 3 次 · 最近 昨天');
    expect(readerReadingSummaryLabel({ sessionCount: 3, totalMs: 95 * 60_000, lastReadAt: new Date(2026, 8, 20, 12).toISOString() }, now)).toBe('累计 1 小时 35 分 · 3 次 · 最近 9月20日');
    expect(readerReadingSummaryLabel({ sessionCount: 1, totalMs: 60_000, lastReadAt: new Date(2025, 11, 31, 12).toISOString() }, now)).toBe('累计 1 分钟 · 1 次 · 最近 2025年12月31日');
  });

  it('adds the reading record to the book export', () => {
    const book = { ...draft, id: 'b', createdAt: timestamp, updatedAt: timestamp, deletedAt: null };
    const markdown = renderReaderBookMarkdown({ book, passages: [], discussions: [], reading: { sessionCount: 2, totalMs: 30 * 60_000, lastReadAt: null } });
    expect(markdown).toContain('- 阅读记录：累计 30 分钟 · 2 次');
    expect(renderReaderBookMarkdown({ book, passages: [], discussions: [] })).not.toContain('阅读记录');
  });
});

describe('reading records page', () => {
  const at = (day: number, hour: number, minutes: number, startPage: number | null, endPage: number | null, id = `${day}-${hour}`): ReaderReadingSession => {
    const startedAt = new Date(2026, 8, day, hour).toISOString();
    return { id, bookId: 'b', startedAt, endedAt: new Date(Date.parse(startedAt) + minutes * 60_000).toISOString(), durationMs: minutes * 60_000, startPage, endPage, createdAt: startedAt };
  };
  const sessions = [at(29, 9, 20, 10, 30), at(30, 21, 40, 50, 80), at(30, 8, 15, 30, 50), at(20, 12, 5, null, null)];

  it('groups sessions by local day, newest first, with each day total', () => {
    const days = readerReadingDays(sessions, new Date(2026, 8, 30, 23));
    expect(days.map((day) => [day.label, day.totalMs / 60_000, day.sessions.map((item) => item.id)])).toEqual([
      ['今天', 55, ['30-21', '30-8']],
      ['昨天', 20, ['29-9']],
      ['9月20日', 5, ['20-12']],
    ]);
  });

  it('totals time, averages it, and counts pages only from sessions with both ends', () => {
    expect(readerReadingStats(sessions)).toEqual({
      totalMs: 80 * 60_000, sessionCount: 4, averageMs: 20 * 60_000, pagesRead: 70,
      firstReadAt: sessions[3]!.startedAt, lastReadAt: sessions[1]!.endedAt,
    });
    expect(readerReadingStats([at(1, 1, 3, null, null)]).pagesRead).toBeNull();
    expect(readerReadingStats([])).toMatchObject({ sessionCount: 0, averageMs: 0, firstReadAt: null });
  });

  it('describes the pages of one session', () => {
    expect(readerSessionPagesLabel({ startPage: 50, endPage: 72 })).toBe('第 50 → 72 页 · 22 页');
    expect(readerSessionPagesLabel({ startPage: null, endPage: 72 })).toBe('读到第 72 页');
    expect(readerSessionPagesLabel({ startPage: 72, endPage: 72 })).toBe('读到第 72 页');
    expect(readerSessionPagesLabel({ startPage: 80, endPage: 60 })).toBe('第 80 → 60 页');
    expect(readerSessionPagesLabel({ startPage: 50, endPage: null })).toBeNull();
  });

  it('asks a too-long timer for minutes between 1 and the time it ran', () => {
    expect(readerSessionMinutesEntry('45', 10 * 3_600_000)).toEqual({ ok: true, minutes: 45 });
    expect(readerSessionMinutesEntry('600', 10 * 3_600_000)).toEqual({ ok: true, minutes: 600 });
    expect(readerSessionMinutesEntry('601', 10 * 3_600_000)).toEqual({ ok: false, error: '阅读时长请填写 1 到 600 之间的分钟数。' });
    expect(readerSessionMinutesEntry('0', 10 * 3_600_000)).toMatchObject({ ok: false });
    expect(readerSessionMinutesEntry('', 10 * 3_600_000)).toMatchObject({ ok: false });
    expect(readerSessionMinutesEntry('2.5', 10 * 3_600_000)).toMatchObject({ ok: false });
  });

  it('corrects a session from minutes and optional pages, keeping its start', () => {
    const session = { startedAt: '2026-09-30T21:00:00.000Z' };
    expect(readerSessionEditEntry(session, { minutes: '40', startPage: '50', endPage: '' }, 256)).toEqual({
      ok: true, draft: { startedAt: session.startedAt, endedAt: '2026-09-30T21:40:00.000Z', startPage: 50, endPage: null },
    });
    expect(readerSessionEditEntry(session, { minutes: '0', startPage: '', endPage: '' }, 256)).toMatchObject({ ok: false });
    expect(readerSessionEditEntry(session, { minutes: '40', startPage: '', endPage: '300' }, 256)).toEqual({ ok: false, error: '超过全书页数（256）' });
    expect(readerSessionEditEntry(session, { minutes: '40', startPage: '1.5', endPage: '' }, 0)).toEqual({ ok: false, error: '页码请填写整数，或留空。' });
  });

  it('reads a session added by hand, which must end by now', () => {
    const now = new Date(2026, 9, 1, 22, 0);
    const entry = (input: Partial<Parameters<typeof readerManualSessionEntry>[0]>) => readerManualSessionEntry({ daysAgo: 1, time: '21:00', minutes: '30', startPage: '', endPage: '40', ...input }, 256, now);
    expect(entry({})).toEqual({ ok: true, draft: { startedAt: new Date(2026, 8, 30, 21, 0).toISOString(), endedAt: new Date(2026, 8, 30, 21, 30).toISOString(), startPage: null, endPage: 40 } });
    for (const time of ['21：00', '21.00', '2100', '9:05']) expect(entry({ time })).toMatchObject({ ok: true });
    expect(entry({ time: '25:00' })).toEqual({ ok: false, error: '开始时间请按 21:00 的格式填写。' });
    expect(entry({ time: '' })).toMatchObject({ ok: false });
    expect(entry({ daysAgo: 0, time: '21:45' })).toEqual({ ok: false, error: '结束时间不能晚于现在。' });
    expect(entry({ daysAgo: 0, time: '21:30' })).toMatchObject({ ok: true });
    expect(entry({ endPage: '300' })).toEqual({ ok: false, error: '超过全书页数（256）' });
  });

  it('estimates pace from sessions with both pages, and the time left from it', () => {
    expect(readerReadingSpeed(sessions)).toBe(56); // 70 pages over 75 minutes; the pageless session is left out
    expect(readerReadingSpeed([at(1, 1, 9, 10, 20)])).toBeNull();
    expect(readerReadingSpeed([at(1, 1, 30, 20, 10)])).toBeNull();
    expect(readerRemainingMs({ pageCount: 256, pagesRead: 150 }, 53)).toBe(Math.round(106 / 53 * 3_600_000));
    expect(readerRemainingMs({ pageCount: 256, pagesRead: 256 }, 53)).toBeNull();
    expect(readerRemainingMs({ pageCount: 0, pagesRead: 10 }, 53)).toBeNull();
    expect(readerRemainingMs({ pageCount: 256, pagesRead: 10 }, null)).toBeNull();
  });

  it('totals the last 30 days per day, oldest first and ending today', () => {
    const daily = readerDailyReading(sessions, new Date(2026, 8, 30, 23));
    expect(daily).toHaveLength(30);
    expect(daily.at(-1)).toEqual({ key: '2026-09-30', ms: 55 * 60_000 });
    expect(daily.at(-2)).toEqual({ key: '2026-09-29', ms: 20 * 60_000 });
    expect(daily[0]!.key).toBe('2026-09-01');
    expect(daily.filter((day) => day.ms).length).toBe(3);
  });

  it('turns an end time into minutes after the start, across midnight but not past now', () => {
    const startedAt = new Date(2026, 8, 30, 21, 8).toISOString();
    const now = new Date(2026, 9, 1, 7, 20);
    expect(readerMinutesUntilClock(startedAt, '22:30', now)).toEqual({ ok: true, minutes: 82 });
    expect(readerMinutesUntilClock(startedAt, '0130', now)).toEqual({ ok: true, minutes: 262 });
    expect(readerMinutesUntilClock(startedAt, '07:20', now)).toEqual({ ok: true, minutes: 612 });
    expect(readerMinutesUntilClock(startedAt, '08:00', now)).toEqual({ ok: false, error: '结束时间要在开始之后、现在之前。' });
    expect(readerMinutesUntilClock(startedAt, '7点', now)).toEqual({ ok: false, error: '结束时间请按 07:20 的格式填写。' });
    expect(readerClockAfter(startedAt, 82)).toBe('22:30');
    expect(readerClockAfter(startedAt, 612)).toBe('07:20');
  });

  it('restores the page routes for a book, including opening its timer', () => {
    expect(normalizeReaderRoute({ name: 'book-reading', bookId: 'b' })).toEqual({ name: 'book-reading', bookId: 'b' });
    expect(normalizeReaderRoute({ name: 'book-reading' })).toBeNull();
    expect(normalizeReaderRoute({ name: 'book', bookId: 'b', tab: 'passages', endSession: true })).toEqual({ name: 'book', bookId: 'b', tab: 'passages', endSession: true });
    expect(normalizeReaderRoute({ name: 'book', bookId: 'b', endSession: 'yes' })).toEqual({ name: 'book', bookId: 'b', tab: 'passages' });
  });
});

function createDatabase(): LocalDatabase {
  const raw = new DatabaseSync(':memory:');
  for (const statement of READER_DATABASE_SCHEMA) raw.exec(statement);
  const values = (parameters: readonly unknown[]) => parameters.map((value) => typeof value === 'boolean' ? Number(value) : value) as (string | number | null)[];
  const context = (): SqlWriteContext => ({
    execute: async (sql: string, parameters: readonly unknown[] = []) => {
      const result = raw.prepare(sql).run(...values(parameters));
      const mutation: SqlMutationResult = { rowsAffected: Number(result.changes) };
      if (result.lastInsertRowid !== undefined) mutation.insertId = Number(result.lastInsertRowid);
      return mutation;
    },
    get: async <T>(sql: string, parameters: readonly unknown[] = []) => raw.prepare(sql).get(...values(parameters)) as T,
    getOptional: async <T>(sql: string, parameters: readonly unknown[] = []) => (raw.prepare(sql).get(...values(parameters)) as T | undefined) ?? null,
    getAll: async <T>(sql: string, parameters: readonly unknown[] = []) => raw.prepare(sql).all(...values(parameters)) as T[],
  });
  return {
    ...context(),
    initialize: async () => undefined,
    close: async () => { raw.close(); },
    writeTransaction: async <T>(callback: (transaction: SqlWriteContext) => Promise<T>) => {
      raw.exec('BEGIN');
      try {
        const value = await callback(context());
        raw.exec('COMMIT');
        return value;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
    // Answers once, synchronously: enough to read what a watcher would first see.
    watch: <T>(sql: string, parameters: readonly unknown[], handlers: { onResult: (rows: T[]) => void }) => {
      handlers.onResult(raw.prepare(sql).all(...values(parameters)) as T[]);
    },
  } as LocalDatabase;
}
