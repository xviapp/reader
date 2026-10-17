import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { READER_DATABASE_MIGRATION_STATEMENTS, READER_DATABASE_SCHEMA } from '@/runtime/reader-database-schema';

/** Mirrors the native runner: schema first, then migrations that may re-add existing columns. */
function initialize(database: DatabaseSync): void {
  for (const statement of READER_DATABASE_SCHEMA) database.exec(statement);
  migrate(database);
}
function migrate(database: DatabaseSync): void {
  for (const statement of READER_DATABASE_MIGRATION_STATEMENTS) {
    try { database.exec(statement); } catch (error) {
      if (!/duplicate column name/iu.test(String(error))) throw error;
    }
  }
}

describe('Reader database compatibility', () => {
  it('accepts a task insert after the legacy ai_tasks schema is upgraded', () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(`
        CREATE TABLE ai_tasks (
          id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, module TEXT NOT NULL,
          subject_id TEXT NOT NULL, operation TEXT NOT NULL, idempotency_key TEXT NOT NULL,
          service_id TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL,
          attempt_count INTEGER NOT NULL, not_before_at TEXT, error_code TEXT,
          error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          deleted_at TEXT, UNIQUE(owner_id, module, idempotency_key)
        )
      `);
      database.prepare(`
        INSERT INTO ai_tasks (
          id, owner_id, module, subject_id, operation, idempotency_key, service_id,
          payload_json, status, attempt_count, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        'legacy-task', 'local', 'reader', 'passage-legacy', 'passage-analysis',
        'analysis:legacy', 'service-1', '{}', 'queued', 0,
        '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z',
      );
      initialize(database);

      expect(database.prepare('PRAGMA table_info(ai_tasks)').all().map((column) => String(column.name))).not.toContain('module');
      expect(database.prepare('SELECT id FROM ai_tasks WHERE id = ?').get('legacy-task')).toEqual({ id: 'legacy-task' });

      const result = database.prepare(`
        INSERT OR IGNORE INTO ai_tasks (
          id, owner_id, subject_id, operation, idempotency_key, service_id,
          payload_json, status, attempt_count, not_before_at, error_code,
          error_message, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, NULL, NULL, NULL, ?, ?, NULL)
      `).run(
        'ai-task-1', 'local', 'passage-1', 'passage-analysis',
        'analysis:passage-1:1:now', 'service-1', '{}',
        '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z',
      );

      expect(Number(result.changes)).toBe(1);

      // The adapter currently runs compatibility statements at initialization;
      // make sure a second initialization remains data-preserving and harmless.
      migrate(database);
      expect(database.prepare('SELECT id FROM ai_tasks ORDER BY id').all()).toEqual([
        { id: 'ai-task-1' },
        { id: 'legacy-task' },
      ]);
    } finally {
      database.close();
    }
  });

  it('adds page counts to books from before they existed, keeping every book', () => {
    const database = new DatabaseSync(':memory:');
    try {
      initialize(database);
      database.exec('DROP TABLE reader_books');
      database.exec(`CREATE TABLE reader_books (
        id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, title TEXT NOT NULL,
        authors_json TEXT NOT NULL, cover_uri TEXT NOT NULL, isbn TEXT NOT NULL,
        publisher TEXT NOT NULL, published_at TEXT NOT NULL, summary TEXT NOT NULL,
        note TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL,
        role_id TEXT NOT NULL, custom_prompt TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
      )`);
      database.exec(`INSERT INTO reader_books VALUES ('old', 'local', '活着', '[]', '', '', '', '', '', '', 'reading', 40, 'r', '', 't', 't', NULL)`);
      migrate(database);
      expect(database.prepare('SELECT id, progress, page_count, pages_read FROM reader_books').all()).toEqual([{ id: 'old', progress: 40, page_count: 0, pages_read: 0 }]);
    } finally {
      database.close();
    }
  });
});
