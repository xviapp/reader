import type { AtomicWriteContext } from './atomic-write';
import type { SqlWriteContext } from './database-contract';

const sqlContexts = new WeakMap<AtomicWriteContext, SqlWriteContext>();

export function createAtomicWriteContext(sql: SqlWriteContext): AtomicWriteContext {
  const context = Object.freeze({}) as AtomicWriteContext;
  sqlContexts.set(context, sql);
  return context;
}

export function sqlWriteContextOf(context: AtomicWriteContext): SqlWriteContext {
  const sql = sqlContexts.get(context);
  if (!sql) throw new Error('Atomic write context does not belong to this process');
  return sql;
}

