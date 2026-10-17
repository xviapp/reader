import { beforeEach, describe, expect, it } from 'vitest';

import {
  ReadingSessions,
  READING_SESSIONS_KEY,
  suggestedPage,
} from '@/core/reading/reading-sessions';
import type { KeyValueStorage } from '@/core/storage/local-state';

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
}

const book = { id: 'book-1' };
let storage: MemoryStorage; let clock: number;

beforeEach(() => { storage = new MemoryStorage(); clock = Date.parse('2026-10-01T12:00:00Z'); });

describe('reading sessions', () => {
  it('persists one timer per book and ends it once', async () => {
    const sessions = new ReadingSessions(storage, () => clock);
    expect(sessions.session(book.id)).toBeUndefined();
    expect(sessions.all()).toEqual([]);
    const started = await sessions.start(book.id);
    await sessions.start('other-book', '百年孤独');
    expect(sessions.all().map((item) => item.bookId)).toEqual([book.id, 'other-book']);
    expect(sessions.session('other-book')).toMatchObject({ title: '百年孤独' });
    await sessions.end('other-book');
    clock += 60_000;
    expect(await sessions.start(book.id)).toEqual(started);

    const later = new ReadingSessions(storage, () => clock);
    await later.load();
    expect(later.session(book.id)).toEqual({ bookId: book.id, startedAt: '2026-10-01T12:00:00.000Z' });
    expect(await later.end(book.id)).toEqual(started);
    expect(await later.end(book.id)).toBeNull();
    expect(JSON.parse(storage.values.get(READING_SESSIONS_KEY)!)).toEqual([]);
  });

  it('keeps only the timers of books that still exist', async () => {
    const sessions = new ReadingSessions(storage, () => clock);
    await sessions.start('kept');
    await sessions.start('gone');
    await sessions.retain(new Set(['kept', 'unrelated']));
    expect(sessions.all().map((item) => item.bookId)).toEqual(['kept']);
    expect(JSON.parse(storage.values.get(READING_SESSIONS_KEY)!)).toEqual([expect.objectContaining({ bookId: 'kept' })]);
    await sessions.retain(new Set());
    expect(sessions.all()).toEqual([]);
  });
});

describe('helpers', () => {
  it('suggests the page of the latest excerpt with a plain page number', () => {
    expect(suggestedPage(['第 12 页', '10'])).toBe(12);
    expect(suggestedPage(['序言', 'p.33'])).toBe(33);
    expect(suggestedPage(['第三章', ''])).toBeNull();
  });
});
