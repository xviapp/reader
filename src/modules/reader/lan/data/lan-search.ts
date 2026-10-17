import type { SqlReadContext } from '@/core/data/database-contract';
import type { LanParameters } from '../application/read-port';
import type { LanPage, LanSearchKind, LanSearchResult } from '../contracts';
import { mediaId } from '../adapters/media-reader';
import { canUseReaderSearchFts, readerSearchFtsMatch } from '../../data/search-schema';
import { DISCUSSION_VISIBLE, MESSAGE_JOIN, PASSAGE_JOIN, identifier, invalid, nullable, paging, text, validate, type LanRow } from './lan-query';

export async function searchLan(database: SqlReadContext, workspaceId: string, parameters: LanParameters): Promise<LanPage<LanSearchResult>> {
  validate(parameters, ['q', 'kind', 'bookId', 'cursor', 'limit']);
  const query = (parameters.q ?? '').trim();
  if (query.length > 200) invalid();
  const kind = parameters.kind ?? 'all';
  if (!['all', 'book', 'passage', 'discussion', 'message'].includes(kind)) invalid();
  const bookId = parameters.bookId === undefined ? null : identifier(parameters.bookId);
  const request = paging(parameters, JSON.stringify(['search', query, kind, bookId]));
  if (!query) return { items: [], nextCursor: null };
  if (canUseReaderSearchFts(query)) return searchLanWithFts(database, workspaceId, query, kind, bookId, request);
  const branches: string[] = [];
  const bindings: unknown[] = [];
  const add = (type: string, sql: string) => { if (kind === 'all' || kind === type) { branches.push(sql); bindings.push(workspaceId); } };
  add('book', `SELECT 'book' AS kind, b.id, b.id AS book_id, NULL AS discussion_id, b.title,
    b.authors_json AS subtitle, b.cover_uri AS image_uri, '' AS source_text,
    b.title || char(10) || b.authors_json || char(10) || b.isbn || char(10) || b.summary || char(10) || b.note AS search_text,
    b.updated_at AS sort_at FROM reader_books b WHERE b.owner_id = ? AND b.deleted_at IS NULL`);
  add('passage', `SELECT 'passage' AS kind, p.id, p.book_id, NULL AS discussion_id, p.title, b.title AS subtitle, p.image_uri,
    p.source_text || char(10) || p.raw_source_text AS source_text,
    p.title || char(10) || p.page_label || char(10) || p.summary || char(10) || p.source_text || char(10) || p.raw_source_text AS search_text,
    p.updated_at AS sort_at FROM reader_passages p ${PASSAGE_JOIN} WHERE p.owner_id = ? AND p.deleted_at IS NULL`);
  add('discussion', `SELECT 'discussion' AS kind, d.id, d.book_id, d.id AS discussion_id, d.title,
    COALESCE(b.title, '独立讨论') AS subtitle, '' AS image_uri, '' AS source_text,
    d.title AS search_text, d.updated_at AS sort_at FROM reader_discussions d
    LEFT JOIN reader_books b ON b.id = d.book_id AND b.owner_id = d.owner_id WHERE ${DISCUSSION_VISIBLE}`);
  add('message', `SELECT 'message' AS kind, m.id, d.book_id, d.id AS discussion_id, d.title,
    COALESCE(b.title, '独立讨论') AS subtitle, '' AS image_uri, '' AS source_text,
    m.content AS search_text, m.updated_at AS sort_at FROM reader_messages m ${MESSAGE_JOIN}
    LEFT JOIN reader_books b ON b.id = d.book_id AND b.owner_id = d.owner_id
    WHERE ${DISCUSSION_VISIBLE} AND m.deleted_at IS NULL`);
  const cursor = request.cursor;
  const rows = await database.getAll<LanRow>(`SELECT kind, id, book_id, discussion_id, title, subtitle, image_uri, sort_at,
    kind || ':' || id AS entity_key,
    substr(search_text, max(1, instr(lower(search_text), lower(needle)) - 60), 240) AS snippet,
    CASE WHEN instr(lower(source_text), lower(needle)) > 0 THEN 1 ELSE 0 END AS source_match
    FROM (${branches.join(' UNION ALL ')}) hits CROSS JOIN (SELECT ? AS needle) term
    WHERE instr(lower(search_text), lower(needle)) > 0 ${bookId ? 'AND book_id = ?' : ''}
    ${cursor ? "AND (sort_at < ? OR (sort_at = ? AND kind || ':' || id > ?))" : ''}
    ORDER BY sort_at DESC, entity_key ASC LIMIT ?`,
  [...bindings, query, ...(bookId ? [bookId] : []), ...(cursor ? [cursor[0], cursor[0], cursor[1]] : []), request.limit + 1]);
  const selected = rows.slice(0, request.limit);
  const last = selected.at(-1);
  return { items: selected.map((row) => {
    const type = text(row, 'kind') as LanSearchKind;
    return { kind: type, id: text(row, 'id'), bookId: nullable(row, 'book_id'), discussionId: nullable(row, 'discussion_id'),
      title: text(row, 'title'), subtitle: type === 'book' ? authors(text(row, 'subtitle')) : text(row, 'subtitle'),
      snippet: text(row, 'snippet'), match: row.source_match === 1 ? 'source' : 'text',
      imageId: type === 'book' || type === 'passage' ? mediaId(type, text(row, 'id'), text(row, 'image_uri')) : null };
  }), nextCursor: rows.length > request.limit && last ? JSON.stringify([request.scope, text(last, 'sort_at'), text(last, 'entity_key')]) : null };
}

async function searchLanWithFts(
  database: SqlReadContext,
  workspaceId: string,
  query: string,
  kind: string,
  bookId: string | null,
  request: ReturnType<typeof paging>,
): Promise<LanPage<LanSearchResult>> {
  const branches: string[] = [];
  const bindings: unknown[] = [];
  const match = readerSearchFtsMatch(query);
  const add = (type: string, sql: string) => {
    if (kind === 'all' || kind === type) {
      branches.push(sql);
      bindings.push(workspaceId, match);
    }
  };
  add('book', `SELECT 'book' AS kind, b.id, b.id AS book_id, NULL AS discussion_id,
    b.title, b.authors_json AS subtitle, b.cover_uri AS image_uri, '' AS source_text,
    b.title || char(10) || b.authors_json || char(10) || b.isbn || char(10) || b.summary || char(10) || b.note AS search_text,
    b.updated_at AS sort_at
    FROM reader_search_fts INNER JOIN reader_books b
      ON b.owner_id = reader_search_fts.owner_id AND b.id = reader_search_fts.entity_id
    WHERE reader_search_fts.owner_id = ? AND reader_search_fts.kind = 'book'
      AND reader_search_fts MATCH ? AND b.deleted_at IS NULL`);
  add('passage', `SELECT 'passage' AS kind, p.id, p.book_id, NULL AS discussion_id,
    p.title, b.title AS subtitle, p.image_uri, reader_search_fts.source_text,
    p.title || char(10) || p.page_label || char(10) || p.summary || char(10) || p.source_text || char(10) || p.raw_source_text AS search_text,
    p.updated_at AS sort_at
    FROM reader_search_fts INNER JOIN reader_passages p
      ON p.owner_id = reader_search_fts.owner_id AND p.id = reader_search_fts.entity_id
    INNER JOIN reader_books b ON b.id = p.book_id AND b.owner_id = p.owner_id
    WHERE reader_search_fts.owner_id = ? AND reader_search_fts.kind = 'passage'
      AND reader_search_fts MATCH ? AND p.deleted_at IS NULL AND b.deleted_at IS NULL`);
  add('discussion', `SELECT 'discussion' AS kind, d.id, d.book_id, d.id AS discussion_id,
    d.title, COALESCE(b.title, '独立讨论') AS subtitle, '' AS image_uri, '' AS source_text,
    d.title || char(10) || d.last_message_preview AS search_text, d.updated_at AS sort_at
    FROM reader_search_fts INNER JOIN reader_discussions d
      ON d.owner_id = reader_search_fts.owner_id AND d.id = reader_search_fts.entity_id
    LEFT JOIN reader_books b ON b.id = d.book_id AND b.owner_id = d.owner_id
    WHERE reader_search_fts.owner_id = ? AND reader_search_fts.kind = 'discussion'
      AND reader_search_fts MATCH ? AND d.deleted_at IS NULL
      AND (d.book_id IS NULL OR (b.id IS NOT NULL AND b.deleted_at IS NULL))`);
  add('message', `SELECT 'message' AS kind, m.id, d.book_id, d.id AS discussion_id,
    d.title, COALESCE(b.title, '独立讨论') AS subtitle, '' AS image_uri, '' AS source_text,
    m.content AS search_text, m.updated_at AS sort_at
    FROM reader_search_fts INNER JOIN reader_messages m
      ON m.owner_id = reader_search_fts.owner_id AND m.id = reader_search_fts.entity_id
    INNER JOIN reader_discussions d ON d.id = m.discussion_id AND d.owner_id = m.owner_id
    LEFT JOIN reader_books b ON b.id = d.book_id AND b.owner_id = d.owner_id
    WHERE reader_search_fts.owner_id = ? AND reader_search_fts.kind = 'message'
      AND reader_search_fts MATCH ? AND m.deleted_at IS NULL AND d.deleted_at IS NULL
      AND (d.book_id IS NULL OR (b.id IS NOT NULL AND b.deleted_at IS NULL))`);
  const cursor = request.cursor;
  const rows = await database.getAll<LanRow>(`SELECT kind, id, book_id, discussion_id, title, subtitle, image_uri, sort_at,
    kind || ':' || id AS entity_key,
    substr(search_text, max(1, instr(lower(search_text), lower(needle)) - 60), 240) AS snippet,
    CASE WHEN instr(lower(source_text), lower(needle)) > 0 THEN 1 ELSE 0 END AS source_match
    FROM (${branches.join(' UNION ALL ')}) hits CROSS JOIN (SELECT ? AS needle) term
    WHERE instr(lower(search_text), lower(needle)) > 0 ${bookId ? 'AND book_id = ?' : ''}
    ${cursor ? "AND (sort_at < ? OR (sort_at = ? AND kind || ':' || id > ?))" : ''}
    ORDER BY sort_at DESC, entity_key ASC LIMIT ?`,
  [...bindings, query, ...(bookId ? [bookId] : []), ...(cursor ? [cursor[0], cursor[0], cursor[1]] : []), request.limit + 1]);
  const selected = rows.slice(0, request.limit);
  const last = selected.at(-1);
  return { items: selected.map((row) => {
    const type = text(row, 'kind') as LanSearchKind;
    return { kind: type, id: text(row, 'id'), bookId: nullable(row, 'book_id'), discussionId: nullable(row, 'discussion_id'),
      title: text(row, 'title'), subtitle: type === 'book' ? authors(text(row, 'subtitle')) : text(row, 'subtitle'),
      snippet: text(row, 'snippet'), match: row.source_match === 1 ? 'source' : 'text',
      imageId: type === 'book' || type === 'passage' ? mediaId(type, text(row, 'id'), text(row, 'image_uri')) : null };
  }), nextCursor: rows.length > request.limit && last ? JSON.stringify([request.scope, text(last, 'sort_at'), text(last, 'entity_key')]) : null };
}

function authors(value: string): string {
  try { const items: unknown = JSON.parse(value); return Array.isArray(items) ? items.filter((item) => typeof item === 'string').join(' / ') : ''; }
  catch { return ''; }
}
