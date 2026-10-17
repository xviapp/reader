export interface SqlMutationResult {
  insertId?: number;
  rowsAffected: number;
}

export interface SqlReadContext {
  get<T>(sql: string, parameters?: readonly unknown[]): Promise<T>;
  getOptional<T>(sql: string, parameters?: readonly unknown[]): Promise<T | null>;
  getAll<T>(sql: string, parameters?: readonly unknown[]): Promise<T[]>;
}

export interface SqlWriteContext extends SqlReadContext {
  execute(sql: string, parameters?: readonly unknown[]): Promise<SqlMutationResult>;
}

export interface QueryObserver<T> {
  onResult(rows: readonly T[]): void;
  onError(error: Error): void;
}

export interface QueryWatchOptions {
  signal?: AbortSignal;
  triggerImmediate?: boolean;
  tables?: readonly string[];
}

export interface LocalDatabaseMigration {
  toVersion: number;
  statements: readonly string[];
  ignoreDuplicateColumns?: boolean;
}

export interface LocalDatabaseDefinition {
  version: number;
  schemaStatements?: readonly string[];
  initializeSchema?: (write: SqlWriteContext) => Promise<void>;
  migrations?: readonly LocalDatabaseMigration[];
}

export interface LocalDatabase extends SqlWriteContext {
  initialize(): Promise<void>;
  close(): Promise<void>;
  writeTransaction<T>(callback: (transaction: SqlWriteContext) => Promise<T>): Promise<T>;
  watch<T>(
    sql: string,
    parameters: readonly unknown[],
    observer: QueryObserver<T>,
    options?: QueryWatchOptions,
  ): void;
}

export const LOCAL_WORKSPACE_ID = 'local';
