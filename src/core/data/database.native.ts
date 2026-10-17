import { open, type DB, type QueryResult, type Scalar, type Transaction } from '@op-engineering/op-sqlite';

import type {
  LocalDatabase,
  QueryObserver,
  QueryWatchOptions,
  SqlMutationResult,
  SqlWriteContext,
} from './database-contract';
import { mutatedTablesOf, readTablesOf, tableScopesIntersect } from './sql-table-scope';
import { applyMigrations, type DatabaseMigration, type DatabaseMigrationBaseline } from './migrations';

interface Invalidator {
  refresh(): void;
  tables: ReadonlySet<string> | null;
}

function errorOf(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback);
}

function scalarParameters(parameters: readonly unknown[] = []): Scalar[] {
  return parameters.map((value) => {
    if (
      value === null
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
      || value instanceof Uint8Array
    ) return value;
    throw new TypeError('SQLite parameters must be scalar values');
  });
}

function mutationResult(result: QueryResult): SqlMutationResult {
  return {
    rowsAffected: result.rowsAffected,
    ...(typeof result.insertId === 'number' ? { insertId: result.insertId } : {}),
  };
}

function contextOf(
  executeQuery: (sql: string, parameters: Scalar[]) => Promise<QueryResult>,
  onMutation?: (sql: string) => void,
): SqlWriteContext {
  const query = (sql: string, parameters: readonly unknown[] = []) => (
    executeQuery(sql, scalarParameters(parameters))
  );
  return {
    async execute(sql, parameters = []) {
      const result = mutationResult(await query(sql, parameters));
      onMutation?.(sql);
      return result;
    },
    async get<T>(sql: string, parameters = []) {
      const row = (await query(sql, parameters)).rows[0];
      if (!row) throw new Error('SQLite query returned no rows');
      return row as T;
    },
    async getOptional<T>(sql: string, parameters = []) {
      return ((await query(sql, parameters)).rows[0] as T | undefined) ?? null;
    },
    async getAll<T>(sql: string, parameters = []) {
      return (await query(sql, parameters)).rows as T[];
    },
  };
}

export class OpSqliteDatabase implements LocalDatabase {
  private readonly raw: DB;
  private readonly invalidators = new Set<Invalidator>();
  private initialized = false;
  private closed = false;

  constructor(
    private readonly schemaStatements: readonly string[],
    private readonly name: string,
    private readonly migrationStatements: readonly string[] = [],
    private readonly migrations?: readonly DatabaseMigration[],
    private readonly migrationBaseline?: DatabaseMigrationBaseline,
  ) {
    this.raw = open({ name });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.closed) throw new Error('Local database is closed');
    await this.raw.execute('PRAGMA journal_mode = WAL');
    await this.raw.execute('PRAGMA foreign_keys = ON');
    await this.createSchemaAndApplyMigrations();
    this.initialized = true;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.invalidators.clear();
    await this.raw.closeAsync();
  }

  async execute(sql: string, parameters: readonly unknown[] = []): Promise<SqlMutationResult> {
    this.requireReady();
    let result: QueryResult | null = null;
    await this.raw.transaction(async (transaction) => {
      result = await transaction.execute(sql, scalarParameters(parameters));
    });
    this.invalidate(mutatedTablesOf(sql));
    if (!result) throw new Error('SQLite mutation did not complete');
    return mutationResult(result);
  }

  async get<T>(sql: string, parameters: readonly unknown[] = []): Promise<T> {
    this.requireReady();
    return contextOf((query, values) => this.raw.execute(query, values)).get<T>(sql, parameters);
  }

  async getOptional<T>(sql: string, parameters: readonly unknown[] = []): Promise<T | null> {
    this.requireReady();
    return contextOf((query, values) => this.raw.execute(query, values)).getOptional<T>(sql, parameters);
  }

  async getAll<T>(sql: string, parameters: readonly unknown[] = []): Promise<T[]> {
    this.requireReady();
    return contextOf((query, values) => this.raw.execute(query, values)).getAll<T>(sql, parameters);
  }

  async writeTransaction<T>(callback: (transaction: SqlWriteContext) => Promise<T>): Promise<T> {
    this.requireReady();
    let completed = false;
    let output: T | undefined;
    const changedTables = new Set<string>();
    let unknownMutation = false;
    await this.raw.transaction(async (transaction: Transaction) => {
      output = await callback(contextOf(
        (sql, parameters) => transaction.execute(sql, parameters),
        (sql) => {
          const tables = mutatedTablesOf(sql);
          if (!tables) unknownMutation = true;
          else for (const table of tables) changedTables.add(table);
        },
      ));
      completed = true;
    });
    if (!completed) throw new Error('SQLite transaction did not complete');
    if (unknownMutation || changedTables.size > 0) this.invalidate(unknownMutation ? null : changedTables);
    return output as T;
  }

  watch<T>(
    sql: string,
    parameters: readonly unknown[],
    observer: QueryObserver<T>,
    options: QueryWatchOptions = {},
  ): void {
    let active = !options.signal?.aborted;
    let running = false;
    let rerun = false;
    const refresh = () => {
      if (!active) return;
      if (running) {
        rerun = true;
        return;
      }
      running = true;
      void this.getAll<T>(sql, parameters).then((rows) => {
        if (active) observer.onResult(rows);
      }).catch((error: unknown) => {
        if (active) observer.onError(errorOf(error, 'Local database query failed'));
      }).finally(() => {
        running = false;
        if (rerun && active) {
          rerun = false;
          refresh();
        }
      });
    };
    const invalidator: Invalidator = {
      refresh,
      tables: options.tables ? new Set(options.tables) : readTablesOf(sql),
    };
    const stop = () => {
      active = false;
      this.invalidators.delete(invalidator);
    };
    this.invalidators.add(invalidator);
    options.signal?.addEventListener('abort', stop, { once: true });
    if (options.triggerImmediate !== false) refresh();
  }

  private requireReady(): void {
    if (!this.initialized) throw new Error('Local database is not initialized');
    if (this.closed) throw new Error('Local database is closed');
  }

  private async createSchemaAndApplyMigrations(): Promise<void> {
    if (this.migrations) {
      // SQLite table rebuilds require this outside the transaction. All foreign
      // keys are checked before commit and re-enabled before the DB is exposed.
      await this.raw.execute('PRAGMA foreign_keys = OFF');
      try {
        await this.raw.transaction(async (transaction) => {
          await applyMigrations(
            contextOf((sql, values) => transaction.execute(sql, values)),
            this.migrations!,
            this.migrationBaseline ? { baseline: this.migrationBaseline } : {},
          );
          const maxVersion = Math.max(...this.migrations!.map((m) => m.version), 0);
          if (maxVersion > 0) {
            await transaction.execute(`PRAGMA user_version = ${maxVersion}`);
          }
        });
      } finally {
        await this.raw.execute('PRAGMA foreign_keys = ON');
      }
      return;
    }
    await this.raw.transaction(async (transaction) => {
      for (const statement of this.schemaStatements) await transaction.execute(statement);
      // Schema creation and data migration share one commit. If any migration
      // fails, newly-created tables and indexes roll back with the data step.
      for (const statement of this.migrationStatements) {
        try {
          await transaction.execute(statement);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/duplicate column name|column .* already exists/iu.test(message)) continue;
          throw error;
        }
      }
      await transaction.execute('PRAGMA user_version = 1');
    });
  }

  private invalidate(changedTables: ReadonlySet<string> | null): void {
    for (const invalidator of this.invalidators) {
      if (tableScopesIntersect(invalidator.tables, changedTables)) invalidator.refresh();
    }
  }
}

export interface LocalDatabaseOptions {
  name: string;
  schemaStatements: readonly string[];
  migrationStatements?: readonly string[];
  migrations?: readonly DatabaseMigration[];
  migrationBaseline?: DatabaseMigrationBaseline;
}

export function createLocalDatabase({ name, schemaStatements, migrationStatements, migrations, migrationBaseline }: LocalDatabaseOptions): LocalDatabase {
  return new OpSqliteDatabase(schemaStatements, name, migrationStatements, migrations, migrationBaseline);
}
