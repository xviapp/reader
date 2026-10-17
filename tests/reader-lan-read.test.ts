import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { SqlWriteContext } from '@/core/data/database-contract';
import { READER_SCHEMA_STATEMENTS } from '@/modules/reader/data/schema';
import { LanReadRepository } from '@/modules/reader/lan/data/lan-read-repository';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

function fixture() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  for (const sql of READER_SCHEMA_STATEMENTS) database.exec(sql);
  const insert = database.prepare(`INSERT INTO reader_books VALUES (?, ?, ?, ?, ?, '', '', '', '', '', ?, 25, 200, 50, ?, ?, ?, ?, ?)`);
  const add = (id: string, status = 'reading', owner = 'local', deleted: string | null = null) => insert.run(
    id, owner, `书 ${id}`, '["作者"]', 'file:///private/cover.png', status, 'secret-role', 'private-prompt', '2026-01-01', '2026-01-01', deleted,
  );
  const read = async <T>(sql: string, parameters: readonly unknown[] = []) => {
    expect(sql.trim()).toMatch(/^SELECT\b/);
    return database.prepare(sql).all(...parameters as SQLInputValue[]) as T[];
  };
  const context: SqlWriteContext = {
    getAll: read,
    get: async <T>(sql: string, parameters?: readonly unknown[]) => (await read<T>(sql, parameters))[0]!,
    getOptional: async <T>(sql: string, parameters?: readonly unknown[]) => (await read<T>(sql, parameters))[0] ?? null,
    execute: async () => { throw new Error('LAN cannot write'); },
  };
  return { database, add, repository: new LanReadRepository({ ...context, writeTransaction: async (callback) => callback(context) }, 'local') };
}

describe('LAN bookshelf SELECT', () => {
  it('enforces workspace visibility and a field whitelist without changing SQLite', async () => {
    const { database, add, repository } = fixture();
    add('visible'); add('deleted', 'reading', 'local', '2026-01-02'); add('other-owner', 'reading', 'other');
    const before = database.prepare('SELECT * FROM reader_books ORDER BY id').all();
    const result = await repository.books({});
    expect(result.items).toEqual([{ id: 'visible', title: '书 visible', authors: ['作者'], status: 'reading', progress: 25, updatedAt: '2026-01-01', coverId: expect.any(String) }]);
    expect(JSON.stringify(result)).not.toMatch(/private|secret|owner|file:|prompt/i);
    expect(database.prepare('SELECT * FROM reader_books ORDER BY id').all()).toEqual(before);
  });
  it('pages through tied sort keys in phone order and removes deleted rows on calibration', async () => {
    const { database, add, repository } = fixture();
    add('b'); add('a'); add('c', 'unread'); add('d', 'finished');
    const first = await repository.books({ limit: '2' });
    expect(first.items.map((book) => book.id)).toEqual(['a', 'b']);
    expect((await repository.books({ limit: '2', cursor: first.nextCursor! })).items.map((book) => book.id)).toEqual(['c', 'd']);
    database.prepare('DELETE FROM reader_books WHERE id = ?').run('a');
    expect((await repository.books({ limit: '2' })).items.map((book) => book.id)).toEqual(['b', 'c']);
  });
  it('rejects actions, foreign workspace selectors, malformed limits and cross-scope cursors', async () => {
    const { add, repository } = fixture();
    add('a'); add('b');
    const first = await repository.books({ limit: '1' });
    for (const input of [{ action: 'delete' }, { owner: 'other' }, { limit: '101' }, { cursor: 'DROP TABLE reader_books' },
      { status: 'finished', cursor: first.nextCursor! }]) {
      await expect(repository.books(input)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    expect((await repository.books({})).items).toHaveLength(2);
  });
});
