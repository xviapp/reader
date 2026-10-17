import { describe, expect, it } from 'vitest';

import { mutatedTablesOf, readTablesOf, tableScopesIntersect } from '@/core/data/sql-table-scope';

describe('SQLite table-scoped invalidation', () => {
  it('collects every table used by joins and nested selects', () => {
    expect([...readTablesOf(`
      SELECT t.id,
        (SELECT m.content FROM assistant_messages m WHERE m.thread_id = t.id LIMIT 1)
      FROM assistant_threads t
      LEFT JOIN assistant_profiles f ON f.id = t.id
    `) ?? []]).toEqual(['assistant_messages', 'assistant_threads', 'assistant_profiles']);
  });

  it('collects the target of supported SQLite mutations', () => {
    expect([...mutatedTablesOf('INSERT OR IGNORE INTO ai_tasks (id) VALUES (?)') ?? []]).toEqual(['ai_tasks']);
    expect([...mutatedTablesOf('UPDATE reader_passages SET title = ? WHERE id = ?') ?? []]).toEqual(['reader_passages']);
    expect([...mutatedTablesOf('DELETE FROM grass_messages WHERE id = ?') ?? []]).toEqual(['grass_messages']);
  });

  it('refreshes only intersecting scopes and falls back globally for unknown SQL', () => {
    const assistant = new Set(['assistant_threads', 'assistant_messages']);
    expect(tableScopesIntersect(assistant, new Set(['assistant_messages']))).toBe(true);
    expect(tableScopesIntersect(assistant, new Set(['reader_books']))).toBe(false);
    expect(tableScopesIntersect(assistant, null)).toBe(true);
    expect(tableScopesIntersect(null, new Set(['reader_books']))).toBe(true);
  });
});
