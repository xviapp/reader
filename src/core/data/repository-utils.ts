import type { SqlReadContext } from './database-contract';

export async function createDatabaseId(
  context: SqlReadContext,
  prefix: string,
): Promise<string> {
  const row = await context.get<{ value: string }>(
    'SELECT lower(hex(randomblob(16))) AS value',
  );
  return `${prefix}-${row.value}`;
}

export function decodeStringArray(value: string, limit = 64): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((item): item is string => typeof item === 'string' && item.length > 0))]
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function decodeObjectArray<T>(
  value: string,
  parse: (candidate: unknown) => T | null,
  limit = 100,
): T[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, limit).map(parse).filter((item): item is T => item !== null);
  } catch {
    return [];
  }
}

export function asBoolean(value: number | boolean): boolean {
  return value === true || Number(value) === 1;
}

export function safeDataError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

/** Escapes a literal search string for SQLite LIKE with `ESCAPE '\\'`. */
export function sqlLikePattern(query: string): string {
  return `%${query.replace(/[\\%_]/gu, '\\$&')}%`;
}

/** Reads a single snapshot from a watch-based subscription as a Promise. */
export function readWatchedSnapshot<T>(
  subscribe: (listener: (items: readonly T[]) => void, onError: (error: Error) => void) => () => void,
): Promise<readonly T[]> {
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    let cleanupPending = false;
    let settled = false;
    const cleanup = () => {
      if (!unsubscribe) {
        cleanupPending = true;
        return;
      }
      const stop = unsubscribe;
      unsubscribe = null;
      stop();
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
      cleanup();
    };
    unsubscribe = subscribe(
      (items) => finish(() => resolve(items)),
      (error) => finish(() => reject(error)),
    );
    if (cleanupPending) cleanup();
  });
}

/** Reads a single matching item from a watch-based subscription as a Promise. */
export async function readWatchedItem<T>(
  subscribe: (includeDeleted: boolean, listener: (items: readonly T[]) => void, onError: (error: Error) => void) => () => void,
  predicate: (item: T) => boolean,
): Promise<T | null> {
  const items = await readWatchedSnapshot<T>((listener, onError) => subscribe(false, listener, onError));
  return items.find(predicate) ?? null;
}

