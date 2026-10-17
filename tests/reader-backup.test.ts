import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import type { LocalDatabase, SqlMutationResult, SqlWriteContext } from '@/core/data/database-contract';
import { LocalReaderRepository } from '@/modules/reader/data/reader-repository';
import { READER_DATABASE_SCHEMA } from '@/runtime/reader-database-schema';

const timestamp = '2026-09-07T00:00:00.000Z';

describe('Reader backup snapshot', () => {
  it('round-trips books, passages, defaults and OCR preferences into an empty workspace', async () => {
    const sourceDatabase = createDatabase();
    const source = new LocalReaderRepository(sourceDatabase, 'local', () => new Date(timestamp));
    await source.ensureDefaults();
    const bookId = await source.createBook({
      title: '复杂', authors: ['作者'], coverUri: '', isbn: '', publisher: '', publishedAt: '', summary: '摘要', note: '',
      status: 'reading', progress: 42, pageCount: 0, pagesRead: 0, roleId: 'reader-role-general', customPrompt: '',
    });
    const firstPassageId = await source.createPassage(bookId, {
      title: '摘录', pageLabel: '42', imageUri: '', rawSourceText: '原始 OCR', sourceText: '整理后的文字',
      ocrScript: 'chinese', ocrBlocks: [],
    });
    const secondPassageId = await source.createPassage(bookId, {
      title: '摘录二', pageLabel: '43', imageUri: '', rawSourceText: '第二条 OCR', sourceText: '第二条正文',
      ocrScript: 'chinese', ocrBlocks: [],
    });
    const firstPassage = await source.getPassage(firstPassageId);
    expect(firstPassage).not.toBeNull();
    await source.savePassageOrganizationCandidate(firstPassageId, firstPassage?.sourceRevision ?? 1, '候选整理结果');
    const discussionId = await source.createDiscussion({
      title: '多摘录讨论', bookId, passageId: firstPassageId, passageIds: [firstPassageId, secondPassageId],
      folderId: null, openingMessage: '这两条摘录如何互相印证？',
    });
    await expect(source.search('整理后的', 'passage')).resolves.toEqual([
      expect.objectContaining({ kind: 'passage', bookId, preview: '', sourceMatch: true }),
    ]);
    const snapshot = await source.createBackupSnapshot();

    const targetDatabase = createDatabase();
    const target = new LocalReaderRepository(targetDatabase, 'local', () => new Date(timestamp));
    await target.ensureDefaults();
    await target.restoreBackupSnapshot(snapshot);
    const restored = await target.createBackupSnapshot();

    expect(restored.books).toEqual(snapshot.books);
    expect(restored.passages).toEqual(snapshot.passages);
    expect(restored.organizationCandidates).toEqual(snapshot.organizationCandidates);
    expect(restored.discussions.find((item) => item.id === discussionId)?.passageIds).toEqual([firstPassageId, secondPassageId]);
    expect(snapshot.discussionSources).toHaveLength(2);
    expect(restored.discussionSources).toEqual(snapshot.discussionSources);
    expect(restored.discussions.find((item) => item.id === discussionId)?.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ discussionId, passageId: firstPassageId, sourceRevision: 1, position: 0 }),
        expect.objectContaining({ discussionId, passageId: secondPassageId, sourceRevision: 1, position: 1 }),
      ]),
    );
    expect(restored.messageSources).toEqual(snapshot.messageSources);
    expect(restored.preferences?.ocrScript).toBe(snapshot.preferences?.ocrScript);
    expect(restored.roles).toEqual(snapshot.roles);
    expect(restored.prompts).toEqual(snapshot.prompts);
    const candidate = restored.organizationCandidates?.find((item) => item.passageId === firstPassageId);
    expect(candidate).toBeDefined();
    await target.applyPassageOrganizationCandidate(firstPassageId, candidate?.id ?? '', 1);
    const applied = await target.getPassage(firstPassageId);
    expect(applied?.sourceText).toContain('候选整理结果');
    expect(applied?.sourceRevision).toBe(2);
  });

  it('replaces existing data atomically with replaceBackupSnapshot', async () => {
    const db = createDatabase();
    const repo = new LocalReaderRepository(db, 'local', () => new Date(timestamp));
    await repo.ensureDefaults();
    await repo.createBook({
      title: '旧书', authors: ['旧作者'], coverUri: '', isbn: '', publisher: '', publishedAt: '', summary: '', note: '',
      status: 'reading', progress: 10, pageCount: 0, pagesRead: 0, roleId: 'reader-role-general', customPrompt: '',
    });
    expect((await repo.createBackupSnapshot()).books).toHaveLength(1);

    // Create a new snapshot with 2 different books
    const sourceDb = createDatabase();
    const sourceRepo = new LocalReaderRepository(sourceDb, 'local', () => new Date(timestamp));
    await sourceRepo.ensureDefaults();
    await sourceRepo.createBook({
      title: '新书一', authors: ['新作者一'], coverUri: '', isbn: '', publisher: '', publishedAt: '', summary: '', note: '',
      status: 'reading', progress: 0, pageCount: 0, pagesRead: 0, roleId: 'reader-role-general', customPrompt: '',
    });
    await sourceRepo.createBook({
      title: '新书二', authors: ['新作者二'], coverUri: '', isbn: '', publisher: '', publishedAt: '', summary: '', note: '',
      status: 'finished', progress: 100, pageCount: 0, pagesRead: 0, roleId: 'reader-role-general', customPrompt: '',
    });
    const newSnapshot = await sourceRepo.createBackupSnapshot();

    // Normal restore should fail because database is not empty
    await expect(repo.restoreBackupSnapshot(newSnapshot)).rejects.toThrow('当前设备已有 Reader 数据');

    // Replace should succeed
    await repo.replaceBackupSnapshot(newSnapshot);
    const replaced = await repo.createBackupSnapshot();
    expect(replaced.books).toHaveLength(2);
    expect(replaced.books.map((b) => b.title)).toEqual(expect.arrayContaining(['新书一', '新书二']));

    // Clear all data should reset books and restore defaults
    await repo.clearAllData();
    const cleared = await repo.createBackupSnapshot();
    expect(cleared.books).toHaveLength(0);
    expect(cleared.roles.length).toBeGreaterThan(0);
    expect(cleared.prompts.length).toBeGreaterThan(0);
  });
});

function createDatabase(): LocalDatabase {
  const raw = new DatabaseSync(':memory:');
  for (const statement of READER_DATABASE_SCHEMA) raw.exec(statement);
  const context = (): SqlWriteContext => ({
    execute: async (sql: string, parameters: readonly unknown[] = []) => {
      const result = raw.prepare(sql).run(...sqlValues(parameters));
      const mutation: SqlMutationResult = { rowsAffected: Number(result.changes) };
      if (result.lastInsertRowid !== undefined) mutation.insertId = Number(result.lastInsertRowid);
      return mutation;
    },
    get: async <T>(sql: string, parameters: readonly unknown[] = []) => raw.prepare(sql).get(...sqlValues(parameters)) as T,
    getOptional: async <T>(sql: string, parameters: readonly unknown[] = []) => (raw.prepare(sql).get(...sqlValues(parameters)) as T | undefined) ?? null,
    getAll: async <T>(sql: string, parameters: readonly unknown[] = []) => raw.prepare(sql).all(...sqlValues(parameters)) as T[],
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
    watch: () => undefined,
  };
}

function sqlValues(parameters: readonly unknown[]): (string | number | null | Uint8Array)[] {
  return parameters.map((value) => typeof value === 'boolean' ? Number(value) : value) as (string | number | null | Uint8Array)[];
}
