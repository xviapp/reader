import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { SqlWriteContext } from '@/core/data/database-contract';
import { READER_SCHEMA_STATEMENTS } from '@/modules/reader/data/schema';
import { LanReadRepository } from '@/modules/reader/lan/data/lan-read-repository';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture() {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  db.exec('PRAGMA foreign_keys = ON');
  for (const statement of READER_SCHEMA_STATEMENTS) db.exec(statement);
  const add = (name: 'books' | 'passages' | 'discussions' | 'messages' | 'folders' | 'discussion_sources' | 'message_sources' | 'passage_organization_candidates', values: Record<string, SQLInputValue>) => {
    const columns = db.prepare(`PRAGMA table_info(reader_${name})`).all() as { name: string; type: string; notnull: number; dflt_value: SQLInputValue }[];
    const supplied: Record<string, SQLInputValue> = { owner_id: 'local', created_at: '2026-01-01', updated_at: '2026-01-01', ...values };
    const selected = columns.filter((column) => column.name in supplied || column.dflt_value === null);
    db.prepare(`INSERT INTO reader_${name} (${selected.map((column) => column.name).join(',')}) VALUES (${selected.map(() => '?').join(',')})`)
      .run(...selected.map((column) => supplied[column.name] ?? (column.notnull ? column.type === 'INTEGER' ? 0 : '' : null)));
  };
  const plans: string[] = [];
  const all = async <T>(sql: string, values: readonly unknown[] = []): Promise<T[]> => {
    expect(sql.trim()).toMatch(/^SELECT\b/u);
    if (process.env.READER_LAN_SCALE === '1' && !plans.length && sql.includes('m.favorite = 1')) {
      const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...values as SQLInputValue[]) as { detail: string }[];
      plans.push(...rows.map((row) => row.detail));
    }
    return db.prepare(sql).all(...values as SQLInputValue[]) as T[];
  };
  const read: SqlWriteContext = { getAll: all, get: async <T>(sql: string, values?: readonly unknown[]) => (await all<T>(sql, values))[0]!,
    getOptional: async <T>(sql: string, values?: readonly unknown[]) => (await all<T>(sql, values))[0] ?? null,
    execute: async () => { throw new Error('Read port attempted a write'); } };
  const reader = new LanReadRepository({ ...read, writeTransaction: async (callback) => {
    db.exec('BEGIN'); try { const result = await callback(read); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } }, 'local');
  add('books', { id: 'book', title: '书籍中文', authors_json: '["作者"]', status: 'reading', cover_uri: 'file:///private/reader-media/a.jpg', role_id: 'SECRET_ROLE', custom_prompt: 'SECRET_PROMPT' });
  add('passages', { id: 'passage', book_id: 'book', title: '摘录标题', image_uri: 'file:///private/reader-media/restore/a.jpg', source_text: '中文原文', raw_source_text: '原始OCR', summary: '摘要', source_revision: 2,
    analysis_status: 'failed', organization_status: 'candidate', analysis_error: 'SECRET_KEY', organization_error: 'https://secret-provider.invalid' });
  add('folders', { id: 'folder', name: '分组', position: 2 });
  add('discussions', { id: 'discussion', book_id: 'book', passage_id: 'passage', folder_id: 'folder', title: '讨论标题', unread: 1, last_message_at: '2026-01-01', last_message_preview: 'SECRET_DELETED_PREVIEW' });
  add('messages', { id: 'message', discussion_id: 'discussion', role: 'assistant', content: '中文回答', status: 'completed', favorite: 1, collapsed: 1, error_message: 'SECRET_EXCEPTION' });
  add('discussion_sources', { id: 'ds', discussion_id: 'discussion', passage_id: 'passage', source_revision: 1, position: 0 });
  add('message_sources', { id: 'ms', message_id: 'message', passage_id: 'passage', source_revision: 1, position: 0 });
  add('passage_organization_candidates', { id: 'candidate', passage_id: 'passage', source_revision: 2, source_text: 'SECRET_UNADOPTED_CANDIDATE' });
  return { db, reader, add, plans };
}

describe('Reader LAN complete read projection', () => {
  it.skipIf(process.env.READER_LAN_SCALE !== '1')('measures queries at the specified 100 / 10,000 / 50,000 dataset size', async () => {
    const { db, reader, plans } = fixture();
    const body = '复杂系统中的局部互动形成整体行为。'.repeat(41); // 2,091 UTF-8 bytes.
    const clone = (table: string, count: number, overrides: Record<string, string>) => {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < ?)
        INSERT INTO ${table} (${columns.map((column) => column.name).join(',')})
        SELECT ${columns.map((column) => overrides[column.name] ?? `original.${column.name}`).join(',')}
        FROM n CROSS JOIN (SELECT * FROM ${table} LIMIT 1) original`).run(count);
    };
    db.exec('BEGIN');
    clone('reader_books', 99, { id: "'scale-book-' || x", title: "'规模书籍 ' || x" });
    clone('reader_discussions', 99, { id: "'scale-discussion-' || x", book_id: "'scale-book-' || x" });
    clone('reader_passages', 9999, { id: "'scale-passage-' || x", book_id: "CASE WHEN x%100=0 THEN 'book' ELSE 'scale-book-' || (x%100) END" });
    clone('reader_messages', 49999, { id: "'scale-message-' || x", discussion_id: "CASE WHEN x%100=0 THEN 'discussion' ELSE 'scale-discussion-' || (x%100) END" });
    db.prepare('UPDATE reader_passages SET source_text = ?, raw_source_text = ?, summary = ?').run(body, body, body);
    db.prepare('UPDATE reader_messages SET content = ?').run(body);
    db.exec('COMMIT');
    const timings: Record<string, number[]> = {};
    const reads = { books: () => reader.books({}), passages: () => reader.passages({ bookId: 'book' }), messages: () => reader.messages({ discussionId: 'discussion' }),
      favorites: () => reader.favorites({}), search: () => reader.search({ q: '整体行为' }), scopedSearch: () => reader.search({ q: '整体行为', bookId: 'book' }) };
    for (const [name, read] of Object.entries(reads)) {
      const elapsed: number[] = [];
      for (let index = 0; index < 10; index++) {
        const started = performance.now(); const value = await read(); elapsed.push(performance.now() - started);
        expect(value.items.length).toBeLessThanOrEqual(50);
        if (name === 'search') expect(JSON.stringify(value).length).toBeLessThan(80_000);
      }
      timings[name] = elapsed.sort((a, b) => a - b);
    }
    const measured = Object.fromEntries(Object.entries(timings).map(([name, times]) => [name, { medianMs: Math.round(times[5]!), p95Ms: Math.round(times[9]!) }]));
    expect(plans.join('\n')).toContain('reader_messages_owner_favorite_page');
    expect(plans.join('\n')).not.toContain('USE TEMP B-TREE FOR ORDER BY');
    process.stdout.write(`LAN SQLite scale (desktop, not device acceptance): ${JSON.stringify({ books: 100, passages: 10_000, messages: 50_000, bodyBytes: Buffer.byteLength(body), measured, favoritePlan: plans })}\n`);
  }, 30_000);

  it('projects all named queries without sensitive fields or business writes', async () => {
    const { db, reader } = fixture();
    const before = db.prepare('SELECT total_changes() AS count').get();
    const results = [await reader.books({}), await reader.book({ id: 'book' }), await reader.passages({ bookId: 'book' }),
      await reader.passage({ id: 'passage' }), await reader.folders({}), await reader.discussions({}),
      await reader.discussion({ id: 'discussion' }), await reader.messages({ discussionId: 'discussion' }),
      await reader.message({ id: 'message' }), await reader.favorites({}), await reader.search({ q: '中文' })];
    expect(JSON.stringify(results)).not.toMatch(/SECRET|file:|private|reader-media|owner_id|roleId|customPrompt|collapsed|errorMessage|secret-provider/u);
    expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    expect((await reader.book({ id: 'book' })).passageCount).toBe(1);
    expect((await reader.discussion({ id: 'discussion' })).sources[0]).toMatchObject({ state: 'updated', sourceRevision: 1, currentRevision: 2 });
    expect((await reader.discussions({})).items[0]?.lastMessagePreview).toBe('中文回答');
  });

  it('enforces the entire parent chain for details, search, favorites, live replies and media', async () => {
    const { db, reader } = fixture();
    const image = (await reader.passage({ id: 'passage' })).imageId!;
    expect(await reader.media({ id: image })).toEqual({ uri: 'file:///private/reader-media/restore/a.jpg' });
    db.prepare('UPDATE reader_books SET deleted_at = ? WHERE id = ?').run('2026-01-02', 'book');
    for (const read of [() => reader.book({ id: 'book' }), () => reader.passage({ id: 'passage' }),
      () => reader.discussion({ id: 'discussion' }), () => reader.message({ id: 'message' }), () => reader.media({ id: image }),
      () => reader.pendingMessages({ discussionId: 'discussion' }), () => reader.passages({ bookId: 'book' })]) {
      await expect(read()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect((await reader.discussions({})).items).toEqual([]);
    expect((await reader.favorites({})).items).toEqual([]);
    expect((await reader.search({ q: '中文' })).items).toEqual([]);
    expect([...await reader.visibleMessageIds(['message'])]).toEqual([]);
    db.prepare('UPDATE reader_books SET deleted_at = NULL WHERE id = ?').run('book');
    db.prepare('DELETE FROM reader_books WHERE id = ?').run('book');
    expect((await reader.favorites({})).items).toEqual([]);
    expect((await reader.search({ q: '中文' })).items).toEqual([]);
  });

  it('withholds hidden source text while preserving visible independent discussion history', async () => {
    const { db, reader } = fixture();
    db.prepare('UPDATE reader_discussions SET book_id = NULL WHERE id = ?').run('discussion');
    db.prepare('UPDATE reader_passages SET deleted_at = ? WHERE id = ?').run('2026-01-02', 'passage');
    expect((await reader.discussion({ id: 'discussion' })).sources).toEqual([
      { passageId: null, bookId: null, title: '来源已不可用', sourceRevision: 1, currentRevision: null, state: 'unavailable' },
    ]);
    expect((await reader.message({ id: 'message' })).content).toBe('中文回答');
    expect((await reader.search({ q: '中文原文' })).items).toEqual([]);
    db.prepare('DELETE FROM reader_folders WHERE id = ?').run('folder');
    expect((await reader.discussions({ folderId: 'ungrouped' })).items).toHaveLength(1);
  });

  it('invalidates media identifiers when a reference changes in the same timestamp', async () => {
    const { db, reader } = fixture();
    const original = (await reader.book({ id: 'book' })).coverId!;
    db.prepare('UPDATE reader_books SET cover_uri = ? WHERE id = ?').run('file:///private/reader-media/b.jpg', 'book');
    const changed = (await reader.book({ id: 'book' })).coverId!;
    expect(changed).not.toBe(original);
    await expect(reader.media({ id: original })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await reader.media({ id: changed })).uri).toMatch(/\/b\.jpg$/u);
    for (const id of ['../reader-local.db', '%2e%2e', 'file:///private/a.jpg', '0000', changed + '0']) {
      await expect(reader.media({ id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('pages tied messages toward history and retrieves full text only on demand', async () => {
    const { reader, add } = fixture();
    add('messages', { id: 'new-a', discussion_id: 'discussion', role: 'assistant', content: '长'.repeat(4000), status: 'completed' });
    add('messages', { id: 'new-b', discussion_id: 'discussion', role: 'user', content: '提问', status: 'completed' });
    const first = await reader.messages({ discussionId: 'discussion', limit: '2' });
    expect(first.items.map((item) => item.id)).toEqual(['new-a', 'new-b']);
    expect(first.items[0]).toMatchObject({ hasMoreContent: true, content: '长'.repeat(2000) });
    expect((await reader.message({ id: 'new-a' })).content).toHaveLength(4000);
    const earlier = await reader.messages({ discussionId: 'discussion', limit: '2', cursor: first.nextCursor! });
    expect(earlier.items.map((item) => item.id)).toEqual(['message']);
    await expect(reader.favorites({ cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('supports bounded literal Chinese search with stable cross-type cursors and workspace isolation', async () => {
    const { reader, add } = fixture();
    add('books', { id: 'other', owner_id: 'foreign', title: '中文秘密', status: 'reading' });
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const result = await reader.search({ q: '中文', limit: '1', ...(cursor ? { cursor } : {}) });
      ids.push(...result.items.map((item) => item.id)); cursor = result.nextCursor;
    } while (cursor);
    expect(ids.sort()).toEqual(['book', 'message', 'passage']);
    expect((await reader.search({ q: '中文原' })).items.map((item) => item.id)).toEqual(['passage']);
    expect((await reader.search({ q: '%' })).items).toEqual([]);
    expect((await reader.search({ q: '中文', kind: 'message' })).items.map((item) => item.id)).toEqual(['message']);
    for (const input of [{ q: 'x'.repeat(201) }, { q: '中文', kind: 'prompt' }, { q: '中文', owner: 'foreign' }, { q: '中文', action: 'delete' }]) {
      await expect(reader.search(input)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
  });
});
