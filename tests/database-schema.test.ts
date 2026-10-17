import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { READER_DATABASE_SCHEMA } from '@/runtime/reader-database-schema';

describe('fresh Reader database', () => {
  it('creates only Reader-owned tables', () => {
    const database = new DatabaseSync(':memory:');
    try {
      for (const statement of READER_DATABASE_SCHEMA) database.exec(statement);
      const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
      expect(tables.map((row) => row.name)).toEqual([
        'ai_tasks',
        'reader_books',
        'reader_discussion_sources',
        'reader_discussions',
        'reader_folders',
        'reader_message_sources',
        'reader_messages',
        'reader_passage_organization_candidates',
        'reader_passages',
        'reader_prompts',
        'reader_reading_sessions',
        'reader_roles',
        'reader_search_fts',
        'reader_search_fts_config',
        'reader_search_fts_content',
        'reader_search_fts_data',
        'reader_search_fts_idx',
        'reader_search_fts_rows',
        'reader_settings',
      ]);
      for (const { name } of tables) {
        const count = database.prepare(`SELECT count(*) AS count FROM ${name}`).get() as { count: number };
        if (name === 'reader_search_fts_config') expect(count.count).toBe(1);
        else if (name === 'reader_search_fts_data') expect(count.count).toBeGreaterThan(0);
        else expect(count).toMatchObject({ count: 0 });
      }
    } finally {
      database.close();
    }
  });
});
