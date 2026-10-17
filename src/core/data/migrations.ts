import type { SqlReadContext, SqlWriteContext } from './database-contract';

export interface DatabaseMigration {
  version: number;
  name: string;
  /** Change this only before release; published migrations are immutable. */
  checksum: string;
  up(transaction: SqlWriteContext): Promise<void>;
}

export interface DatabaseMigrationBaseline {
  /**
   * Reads the version represented by a pre-ledger database. This is called
   * only when local_schema_migrations does not exist. Return null for a new
   * database so the normal migration chain runs from its first step.
   */
  detectAppliedVersion(read: SqlReadContext): Promise<number | null>;
}

export interface ApplyMigrationsOptions {
  baseline?: DatabaseMigrationBaseline;
}

/** Runs inside the adapter's startup transaction, before any business queries. */
export async function applyMigrations(
  write: SqlWriteContext,
  migrations: readonly DatabaseMigration[],
  options: ApplyMigrationsOptions = {},
): Promise<void> {
  validateMigrations(migrations);

  const ledgerExists = await write.getOptional<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'local_schema_migrations'",
  );
  const baselineVersion = ledgerExists || !options.baseline
    ? null
    : await options.baseline.detectAppliedVersion(write);
  validateBaselineVersion(baselineVersion, migrations);

  await write.execute(`CREATE TABLE IF NOT EXISTS local_schema_migrations (
    version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied = await write.getAll<{ version: number; name: string; checksum: string }>('SELECT version, name, checksum FROM local_schema_migrations ORDER BY version');
  const appliedVersions = new Set<number>();
  for (const row of applied) {
    const migration = migrations.find((item) => item.version === row.version);
    if (!migration || migration.name !== row.name || migration.checksum !== row.checksum) {
      throw new Error(`数据库迁移版本不兼容：${row.version} (${row.name})`);
    }
    appliedVersions.add(row.version);
  }
  let changed = false;

  if (baselineVersion !== null) {
    for (const migration of migrations) {
      if (migration.version > baselineVersion) break;
      if (appliedVersions.has(migration.version)) continue;
      await write.execute('INSERT INTO local_schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)', [migration.version, migration.name, migration.checksum, new Date().toISOString()]);
      appliedVersions.add(migration.version);
      changed = true;
    }
  }

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    changed = true;
    await migration.up(write);
    await write.execute('INSERT INTO local_schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)', [migration.version, migration.name, migration.checksum, new Date().toISOString()]);
    appliedVersions.add(migration.version);
  }
  if (!changed) return;
  const violations = await write.getAll<{ table: string; rowid: number }>('PRAGMA foreign_key_check');
  if (violations.length) throw new Error(`数据库引用损坏：${violations[0]?.table}，行 ${violations[0]?.rowid}`);
  const integrity = await write.get<{ integrity_check: string }>('PRAGMA integrity_check');
  if (integrity.integrity_check !== 'ok') throw new Error(`数据库完整性检查失败：${integrity.integrity_check}`);
}

function validateMigrations(migrations: readonly DatabaseMigration[]): void {
  let previousVersion = 0;
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version) || migration.version <= previousVersion) {
      throw new Error('数据库迁移必须按版本递增');
    }
    previousVersion = migration.version;
  }
}

function validateBaselineVersion(version: number | null, migrations: readonly DatabaseMigration[]): void {
  if (version === null) return;
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('存量数据库版本无效');
  if (version === 0) return;
  const migration = migrations.find((item) => item.version === version);
  if (!migration) throw new Error(`存量数据库版本 ${version} 没有对应的迁移定义`);
}
