import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import type { LocalDatabase, SqlWriteContext } from '@/core/data/database-contract';
import { LocalReaderRepository } from '@/modules/reader/data/reader-repository';
import { READER_SCHEMA_STATEMENTS } from '@/modules/reader/data/schema';

const now = '2026-09-02T01:00:00.000Z';
let activeDatabase: DatabaseSync | null = null;

afterEach(() => {
  activeDatabase?.close();
  activeDatabase = null;
});

describe('Reader discussion projection', () => {
  it('synchronizes interrupted message status during startup recovery', async () => {
    const { database, raw } = setupDatabase();
    seedDiscussion(raw, [
      ['question-1', 'user', '问题', 'completed', '2026-09-02T00:00:00.000Z'],
      ['answer-1', 'assistant', '', 'pending', '2026-09-02T00:01:00.000Z'],
    ], { preview: '', status: 'pending', latestAssistantId: null });
    const repository = new LocalReaderRepository(database, 'local', () => new Date(now));

    await repository.recoverInterruptedWork();

    expect(raw.prepare("SELECT status FROM reader_messages WHERE id = 'answer-1'").get()).toMatchObject({ status: 'interrupted' });
    expect(readProjection(raw)).toMatchObject({
      last_message_preview: '',
      last_message_status: 'interrupted',
      latest_assistant_message_id: null,
    });
  });

  it('does not promote an older answer when it is retried and completed', async () => {
    const { database, raw } = setupDatabase();
    seedDiscussion(raw, [
      ['question-1', 'user', '旧问题', 'completed', '2026-09-02T00:00:00.000Z'],
      ['answer-1', 'assistant', '旧回答失败', 'failed', '2026-09-02T00:01:00.000Z'],
      ['question-2', 'user', '新问题', 'completed', '2026-09-02T00:02:00.000Z'],
      ['answer-2', 'assistant', '新回答', 'completed', '2026-09-02T00:03:00.000Z'],
    ], { preview: '新回答', status: 'completed', latestAssistantId: 'answer-2' });
    const repository = new LocalReaderRepository(database, 'local', () => new Date(now));

    await repository.prepareMessageRetry('answer-1');
    expect(readProjection(raw)).toMatchObject({
      last_message_preview: '新回答',
      last_message_status: 'completed',
      latest_assistant_message_id: 'answer-2',
      unread: 0,
    });

    await repository.completeMessage('answer-1', '旧回答重试完成');
    expect(readProjection(raw)).toMatchObject({
      last_message_preview: '新回答',
      last_message_status: 'completed',
      latest_assistant_message_id: 'answer-2',
      unread: 0,
    });
  });

  it('updates generation and unread projection when retrying the latest answer', async () => {
    const { database, raw } = setupDatabase();
    seedDiscussion(raw, [
      ['question-1', 'user', '问题', 'completed', '2026-09-02T00:00:00.000Z'],
      ['answer-1', 'assistant', '失败回答', 'failed', '2026-09-02T00:01:00.000Z'],
    ], { preview: '失败回答', status: 'failed', latestAssistantId: null });
    const repository = new LocalReaderRepository(database, 'local', () => new Date(now));

    await repository.prepareMessageRetry('answer-1');
    expect(readProjection(raw)).toMatchObject({ last_message_preview: '', last_message_status: 'pending' });

    await repository.completeMessage('answer-1', '重试完成');
    expect(readProjection(raw)).toMatchObject({
      last_message_preview: '重试完成',
      last_message_status: 'completed',
      latest_assistant_message_id: 'answer-1',
      unread: 1,
    });
  });
});

function setupDatabase(): { database: LocalDatabase; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  activeDatabase = raw;
  raw.exec('PRAGMA foreign_keys = ON');
  for (const statement of READER_SCHEMA_STATEMENTS) raw.exec(statement);

  const context: SqlWriteContext = {
    async execute(sql, parameters = []) {
      const result = raw.prepare(sql).run(...values(parameters));
      return { rowsAffected: Number(result.changes) };
    },
    async get<T>(sql: string, parameters: readonly unknown[] = []) {
      const row = raw.prepare(sql).get(...values(parameters));
      if (!row) throw new Error('Expected one SQLite row');
      return row as T;
    },
    async getOptional<T>(sql: string, parameters: readonly unknown[] = []) {
      return (raw.prepare(sql).get(...values(parameters)) as T | undefined) ?? null;
    },
    async getAll<T>(sql: string, parameters: readonly unknown[] = []) {
      return raw.prepare(sql).all(...values(parameters)) as T[];
    },
  };
  const database: LocalDatabase = {
    ...context,
    async initialize() {},
    async close() { raw.close(); },
    async writeTransaction<T>(operation: (transaction: SqlWriteContext) => Promise<T>) {
      raw.exec('BEGIN');
      try {
        const result = await operation(context);
        raw.exec('COMMIT');
        return result;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
    watch() {},
  };
  return { database, raw };
}

function seedDiscussion(
  raw: DatabaseSync,
  messages: readonly (readonly [string, 'user' | 'assistant', string, string, string])[],
  projection: { preview: string; status: string | null; latestAssistantId: string | null },
): void {
  raw.prepare(`INSERT INTO reader_discussions (
    id, owner_id, title, book_id, passage_id, folder_id, unread, last_message_at,
    last_message_preview, last_message_status, latest_assistant_message_id,
    created_at, updated_at, deleted_at
  ) VALUES (?, ?, ?, NULL, NULL, NULL, 0, ?, ?, ?, ?, ?, ?, NULL)`).run(
    'discussion-1', 'local', '讨论', messages.at(-1)?.[4] ?? now,
    projection.preview, projection.status, projection.latestAssistantId,
    messages[0]?.[4] ?? now, messages.at(-1)?.[4] ?? now,
  );
  const insert = raw.prepare(`INSERT INTO reader_messages (
    id, owner_id, discussion_id, role, content, status, favorite, collapsed,
    error_message, created_at, updated_at, deleted_at
  ) VALUES (?, 'local', 'discussion-1', ?, ?, ?, 0, 0, NULL, ?, ?, NULL)`);
  for (const [id, role, content, status, createdAt] of messages) {
    insert.run(id, role, content, status, createdAt, createdAt);
  }
}

function readProjection(raw: DatabaseSync): Record<string, unknown> {
  return raw.prepare(`SELECT unread, last_message_at, last_message_preview,
    last_message_status, latest_assistant_message_id
    FROM reader_discussions WHERE id = 'discussion-1'`).get() as Record<string, unknown>;
}

function values(parameters: readonly unknown[]): SQLInputValue[] {
  return parameters.map((value) => typeof value === 'boolean' ? (value ? 1 : 0) : value as SQLInputValue);
}
