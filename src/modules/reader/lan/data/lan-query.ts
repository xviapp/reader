import { LanReadError, type LanPage } from '../contracts';
import type { LanParameters } from '../application/read-port';

export type LanRow = Record<string, string | number | null>;
export const text = (row: LanRow, key: string): string => String(row[key] ?? '');
export const nullable = (row: LanRow, key: string): string | null => row[key] == null ? null : String(row[key]);
export const number = (row: LanRow, key: string): number => Number(row[key] ?? 0);
export function invalid(): never { throw new LanReadError('INVALID_REQUEST'); }
export function missing(): never { throw new LanReadError('NOT_FOUND'); }
export function identifier(value: string | undefined): string {
  if (!value || value.length > 200 || /[\u0000-\u001f]/u.test(value)) invalid();
  return value;
}
export function validate(parameters: LanParameters, allowed: readonly string[]): void {
  if (Object.entries(parameters).some(([key, value]) => !allowed.includes(key) || typeof value !== 'string')) invalid();
}
export function pageLimit(value: string | undefined): number {
  if (value === undefined) return 50;
  if (!/^[1-9]\d{0,2}$/u.test(value) || Number(value) > 100) invalid();
  return Number(value);
}
export interface Paging { limit: number; scope: string; cursor: readonly [string, string] | null }
export function paging(parameters: LanParameters, scope: string): Paging {
  const limit = pageLimit(parameters.limit);
  if (!parameters.cursor) return { limit, scope, cursor: null };
  try {
    if (parameters.cursor.length > 2048) invalid();
    const cursor: unknown = JSON.parse(parameters.cursor);
    if (!Array.isArray(cursor) || cursor.length !== 3 || cursor[0] !== scope
      || typeof cursor[1] !== 'string' || cursor[1].length > 64 || typeof cursor[2] !== 'string'
      || !cursor[2] || cursor[2].length > 256 || /[\u0000-\u001f]/u.test(cursor[2])) invalid();
    return { limit, scope, cursor: [cursor[1], cursor[2]] };
  } catch { return invalid(); }
}
export function page<T>(rows: readonly LanRow[], request: Paging, sort: string, project: (row: LanRow) => T): LanPage<T> {
  const selected = rows.slice(0, request.limit);
  const last = selected.at(-1);
  return { items: selected.map(project), nextCursor: rows.length > request.limit && last
    ? JSON.stringify([request.scope, text(last, sort), text(last, 'id')]) : null };
}
export function strings(value: string): readonly string[] {
  try { const items: unknown = JSON.parse(value); return Array.isArray(items) ? items.filter((item): item is string => typeof item === 'string') : []; }
  catch { return []; }
}

export const DISCUSSION_VISIBLE = `d.owner_id = ? AND d.deleted_at IS NULL AND
  (d.book_id IS NULL OR EXISTS (SELECT 1 FROM reader_books vb WHERE vb.id = d.book_id AND vb.owner_id = d.owner_id AND vb.deleted_at IS NULL))`;
export const PASSAGE_JOIN = 'INNER JOIN reader_books b ON b.id = p.book_id AND b.owner_id = p.owner_id AND b.deleted_at IS NULL';
export const MESSAGE_JOIN = `INNER JOIN reader_discussions d ON d.id = m.discussion_id AND d.owner_id = m.owner_id`;
