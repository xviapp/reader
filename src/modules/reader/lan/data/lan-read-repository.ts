import type { LocalDatabase, SqlReadContext } from '@/core/data/database-contract';

import { LanReadError, type LanBook, type LanBookIndex, type LanPage, type LanPassage, type LanPassageIndex,
  type LanDiscussion, type LanDiscussionIndex, type LanMessage, type LanMessageIndex, type LanSource } from '../contracts';
import type { LanParameters, ReaderLanReadPort } from '../application/read-port';
import { authorizeMediaUri, mediaId, parseMediaId } from '../adapters/media-reader';
import { DISCUSSION_VISIBLE, MESSAGE_JOIN, PASSAGE_JOIN, identifier, missing, nullable, number, page, pageLimit, paging, strings, text, validate, type LanRow } from './lan-query';
import { searchLan } from './lan-search';
import { readerBookProgress } from '../../domain/rules';

export type LanReadDatabase = Pick<LocalDatabase, 'get' | 'getOptional' | 'getAll' | 'writeTransaction'>;

interface BookRow {
  id: string;
  title: string;
  authors_json: string;
  status: LanBookIndex['status'];
  page_count: number;
  pages_read: number;
  updated_at: string;
  sort_status: number;
  cover_uri: string;
}

interface Cursor { status: string; rank: number; updatedAt: string; id: string }

export class LanReadRepository implements ReaderLanReadPort {
  constructor(private readonly database: LanReadDatabase, private readonly workspaceId: string) {}

  async books(parameters: Readonly<Record<string, string>>): Promise<LanPage<LanBookIndex>> {
    if (Object.keys(parameters).some((key) => !['limit', 'cursor', 'status'].includes(key))) invalid();
    const status = parameters.status ?? '';
    if (!['', 'reading', 'unread', 'finished'].includes(status)) invalid();
    const limit = pageLimit(parameters.limit);
    const cursor = parameters.cursor ? parseCursor(parameters.cursor, status) : null;
    const rank = "CASE status WHEN 'reading' THEN 0 WHEN 'unread' THEN 1 ELSE 2 END";
    const rows = await this.database.getAll<BookRow>(
      `SELECT id, title, authors_json, cover_uri, status, page_count, pages_read, updated_at, ${rank} AS sort_status
       FROM reader_books WHERE owner_id = ? AND deleted_at IS NULL
       ${status ? 'AND status = ?' : ''}
       ${cursor ? `AND (${rank} > ? OR (${rank} = ? AND (updated_at < ? OR (updated_at = ? AND id > ?))))` : ''}
       ORDER BY sort_status ASC, updated_at DESC, id ASC LIMIT ?`,
      [this.workspaceId, ...(status ? [status] : []),
        ...(cursor ? [cursor.rank, cursor.rank, cursor.updatedAt, cursor.updatedAt, cursor.id] : []), limit + 1],
    );
    const selected = rows.slice(0, limit);
    const last = selected.at(-1);
    return {
      items: selected.map((row) => ({
        id: row.id, title: row.title, authors: authorsOf(row.authors_json),
        status: row.status, progress: readerBookProgress({ pageCount: row.page_count, pagesRead: row.pages_read }), updatedAt: row.updated_at,
        coverId: mediaId('book', row.id, row.cover_uri),
      })),
      nextCursor: rows.length > limit && last
        ? JSON.stringify({ status, rank: last.sort_status, updatedAt: last.updated_at, id: last.id }) : null,
    };
  }

  async book(parameters: LanParameters): Promise<LanBook> {
    validate(parameters, ['id']);
    const id = identifier(parameters.id);
    return this.database.writeTransaction(async (tx) => {
      const row = await this.bookRow(tx, id);
      const counts = await tx.get<LanRow>(`SELECT
        (SELECT count(*) FROM reader_passages WHERE owner_id = ? AND book_id = ? AND deleted_at IS NULL) AS passages,
        (SELECT count(*) FROM reader_discussions WHERE owner_id = ? AND book_id = ? AND deleted_at IS NULL) AS discussions`,
      [this.workspaceId, id, this.workspaceId, id]);
      return { id, title: text(row, 'title'), authors: authorsOf(text(row, 'authors_json')),
        status: text(row, 'status') as LanBook['status'], progress: readerBookProgress({ pageCount: number(row, 'page_count'), pagesRead: number(row, 'pages_read') }), updatedAt: text(row, 'updated_at'),
        coverId: mediaId('book', id, text(row, 'cover_uri')), isbn: text(row, 'isbn'), publisher: text(row, 'publisher'),
        publishedAt: text(row, 'published_at'), summary: text(row, 'summary'), note: text(row, 'note'),
        createdAt: text(row, 'created_at'), passageCount: number(counts, 'passages'), discussionCount: number(counts, 'discussions') };
    });
  }

  async passages(parameters: LanParameters): Promise<LanPage<LanPassageIndex>> {
    validate(parameters, ['bookId', 'limit', 'cursor']);
    const bookId = identifier(parameters.bookId);
    const request = paging(parameters, `passages:${bookId}`);
    const cursor = request.cursor;
    return this.database.writeTransaction(async (tx) => {
      await this.requireBook(tx, bookId);
      const rows = await tx.getAll<LanRow>(`SELECT ${PASSAGE_INDEX} FROM reader_passages p ${PASSAGE_JOIN}
        WHERE p.owner_id = ? AND p.book_id = ? AND p.deleted_at IS NULL
        ${cursor ? 'AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))' : ''}
        ORDER BY p.created_at DESC, p.id DESC LIMIT ?`,
      [this.workspaceId, bookId, ...(cursor ? [cursor[0], cursor[0], cursor[1]] : []), request.limit + 1]);
      return page(rows, request, 'created_at', passageIndex);
    });
  }

  async passage(parameters: LanParameters): Promise<LanPassage> {
    validate(parameters, ['id']);
    const id = identifier(parameters.id);
    return this.database.writeTransaction(async (tx) => {
      const row = await tx.getOptional<LanRow>(`SELECT ${PASSAGE_INDEX}, b.title AS book_title,
        p.raw_source_text, p.source_text, p.summary, p.suggested_questions_json
        FROM reader_passages p ${PASSAGE_JOIN} WHERE p.owner_id = ? AND p.id = ? AND p.deleted_at IS NULL`, [this.workspaceId, id]);
      if (!row) missing();
      const count = await tx.get<LanRow>(`SELECT count(*) AS count FROM reader_discussions d WHERE ${DISCUSSION_VISIBLE}
        AND (d.passage_id = ? OR EXISTS (SELECT 1 FROM reader_discussion_sources ds WHERE ds.owner_id = d.owner_id AND ds.discussion_id = d.id AND ds.passage_id = ?))`,
      [this.workspaceId, id, id]);
      return { ...passageIndex(row), bookTitle: text(row, 'book_title'), rawSourceText: text(row, 'raw_source_text'),
        sourceText: text(row, 'source_text'), summary: text(row, 'summary'), suggestedQuestions: strings(text(row, 'suggested_questions_json')),
        discussionCount: number(count, 'count') };
    });
  }

  async folders(parameters: LanParameters) {
    validate(parameters, []);
    const rows = await this.database.getAll<LanRow>('SELECT id, name, position FROM reader_folders WHERE owner_id = ? AND deleted_at IS NULL ORDER BY position ASC, name ASC, id ASC', [this.workspaceId]);
    return rows.map((row) => ({ id: text(row, 'id'), name: text(row, 'name'), position: number(row, 'position') }));
  }

  async discussions(parameters: LanParameters): Promise<LanPage<LanDiscussionIndex>> {
    validate(parameters, ['bookId', 'passageId', 'folderId', 'limit', 'cursor']);
    const bookId = parameters.bookId === undefined ? null : identifier(parameters.bookId);
    const passageId = parameters.passageId === undefined ? null : identifier(parameters.passageId);
    const folderId = parameters.folderId === undefined ? null : identifier(parameters.folderId);
    const request = paging(parameters, JSON.stringify(['discussions', bookId, passageId, folderId]));
    const cursor = request.cursor;
    return this.database.writeTransaction(async (tx) => {
      if (bookId) await this.requireBook(tx, bookId);
      if (passageId && !await tx.getOptional(`SELECT p.id FROM reader_passages p ${PASSAGE_JOIN} WHERE p.owner_id = ? AND p.id = ? AND p.deleted_at IS NULL`, [this.workspaceId, passageId])) missing();
      const rows = await tx.getAll<LanRow>(`SELECT ${DISCUSSION_INDEX} FROM reader_discussions d ${DISCUSSION_JOINS}
        WHERE ${DISCUSSION_VISIBLE}
        ${bookId ? 'AND d.book_id = ?' : ''}
        ${passageId ? 'AND (d.passage_id = ? OR EXISTS (SELECT 1 FROM reader_discussion_sources ds WHERE ds.owner_id = d.owner_id AND ds.discussion_id = d.id AND ds.passage_id = ?))' : ''}
        ${folderId === 'ungrouped' ? 'AND f.id IS NULL' : folderId ? 'AND f.id = ?' : ''}
        ${cursor ? 'AND (d.last_message_at < ? OR (d.last_message_at = ? AND d.id < ?))' : ''}
        ORDER BY d.last_message_at DESC, d.id DESC LIMIT ?`,
      [this.workspaceId, ...(bookId ? [bookId] : []), ...(passageId ? [passageId, passageId] : []),
        ...(folderId && folderId !== 'ungrouped' ? [folderId] : []), ...(cursor ? [cursor[0], cursor[0], cursor[1]] : []), request.limit + 1]);
      return page(rows, request, 'last_message_at', discussionIndex);
    });
  }

  async discussion(parameters: LanParameters): Promise<LanDiscussion> {
    validate(parameters, ['id']);
    const id = identifier(parameters.id);
    return this.database.writeTransaction(async (tx) => {
      const row = await tx.getOptional<LanRow>(`SELECT ${DISCUSSION_INDEX}, d.passage_id FROM reader_discussions d ${DISCUSSION_JOINS}
        WHERE ${DISCUSSION_VISIBLE} AND d.id = ?`, [this.workspaceId, id]);
      if (!row) missing();
      const sources = await this.sources(tx, 'discussion', id);
      if (!sources.length && row.passage_id) {
        const source = await tx.getOptional<LanRow>(`SELECT p.id, p.book_id, p.title, p.source_revision AS current_revision,
          NULL AS source_revision FROM reader_passages p ${PASSAGE_JOIN} WHERE p.id = ? AND p.owner_id = ? AND p.deleted_at IS NULL`, [row.passage_id, this.workspaceId]);
        sources.push(source ? projectSource(source) : unavailableSource(null));
      }
      return { ...discussionIndex(row), sources };
    });
  }

  async messages(parameters: LanParameters): Promise<LanPage<LanMessageIndex>> {
    validate(parameters, ['discussionId', 'limit', 'cursor']);
    const id = identifier(parameters.discussionId);
    const request = paging(parameters, `messages:${id}`);
    const cursor = request.cursor;
    return this.database.writeTransaction(async (tx) => {
      await this.requireDiscussion(tx, id);
      const rows = await tx.getAll<LanRow>(`SELECT ${messageColumns(false)} FROM reader_messages m ${MESSAGE_JOIN}
        WHERE ${DISCUSSION_VISIBLE} AND m.deleted_at IS NULL AND m.discussion_id = ?
        ${cursor ? 'AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))' : ''}
        ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
      [this.workspaceId, id, ...(cursor ? [cursor[0], cursor[0], cursor[1]] : []), request.limit + 1]);
      const result = page(rows, request, 'created_at', messageIndex);
      return { items: [...result.items].reverse(), nextCursor: result.nextCursor };
    });
  }

  async message(parameters: LanParameters): Promise<LanMessage> {
    validate(parameters, ['id']);
    const id = identifier(parameters.id);
    return this.database.writeTransaction(async (tx) => {
      const row = await tx.getOptional<LanRow>(`SELECT ${messageColumns(true)} FROM reader_messages m ${MESSAGE_JOIN}
        WHERE ${DISCUSSION_VISIBLE} AND m.deleted_at IS NULL AND m.id = ?`, [this.workspaceId, id]);
      if (!row) missing();
      return { ...messageIndex(row), sources: await this.sources(tx, 'message', id) };
    });
  }

  async favorites(parameters: LanParameters): Promise<LanPage<LanMessageIndex>> {
    validate(parameters, ['limit', 'cursor']);
    const request = paging(parameters, 'favorites');
    const cursor = request.cursor;
    const rows = await this.database.getAll<LanRow>(`SELECT ${messageColumns(false)} FROM reader_messages m ${MESSAGE_JOIN}
      WHERE ${DISCUSSION_VISIBLE} AND m.deleted_at IS NULL AND m.favorite = 1
      ${cursor ? 'AND (m.updated_at < ? OR (m.updated_at = ? AND m.id < ?))' : ''}
      ORDER BY m.updated_at DESC, m.id DESC LIMIT ?`,
    [this.workspaceId, ...(cursor ? [cursor[0], cursor[0], cursor[1]] : []), request.limit + 1]);
    return page(rows, request, 'updated_at', messageIndex);
  }

  search(parameters: LanParameters) { return searchLan(this.database, this.workspaceId, parameters); }

  async media(parameters: LanParameters): Promise<{ uri: string }> {
    validate(parameters, ['id']);
    const reference = parseMediaId(parameters.id ?? '');
    const row = reference.kind === 'book'
      ? await this.database.getOptional<LanRow>('SELECT cover_uri AS uri FROM reader_books WHERE owner_id = ? AND id = ? AND deleted_at IS NULL', [this.workspaceId, reference.id])
      : await this.database.getOptional<LanRow>(`SELECT p.image_uri AS uri FROM reader_passages p ${PASSAGE_JOIN}
        WHERE p.owner_id = ? AND p.id = ? AND p.deleted_at IS NULL`, [this.workspaceId, reference.id]);
    if (!row) missing();
    return authorizeMediaUri(reference, text(row, 'uri'));
  }

  async pendingMessages(parameters: LanParameters): Promise<readonly string[]> {
    validate(parameters, ['discussionId']);
    const id = identifier(parameters.discussionId);
    return this.database.writeTransaction(async (tx) => {
      await this.requireDiscussion(tx, id);
      const rows = await tx.getAll<{ id: string }>(`SELECT m.id FROM reader_messages m ${MESSAGE_JOIN}
        WHERE ${DISCUSSION_VISIBLE} AND m.discussion_id = ? AND m.deleted_at IS NULL AND m.status = 'pending'`, [this.workspaceId, id]);
      return rows.map((row) => row.id);
    });
  }

  async visibleMessageIds(ids: readonly string[]): Promise<ReadonlySet<string>> {
    if (!ids.length) return new Set();
    if (ids.length > 16) invalid();
    const rows = await this.database.getAll<{ id: string }>(`SELECT m.id FROM reader_messages m ${MESSAGE_JOIN}
      WHERE ${DISCUSSION_VISIBLE} AND m.deleted_at IS NULL AND m.id IN (${ids.map(() => '?').join(',')})`, [this.workspaceId, ...ids]);
    return new Set(rows.map((row) => row.id));
  }

  private async requireBook(tx: SqlReadContext, id: string): Promise<void> {
    if (!await tx.getOptional('SELECT id FROM reader_books WHERE owner_id = ? AND id = ? AND deleted_at IS NULL', [this.workspaceId, id])) missing();
  }
  private async requireDiscussion(tx: SqlReadContext, id: string): Promise<void> {
    if (!await tx.getOptional(`SELECT d.id FROM reader_discussions d WHERE ${DISCUSSION_VISIBLE} AND d.id = ?`, [this.workspaceId, id])) missing();
  }
  private async bookRow(tx: SqlReadContext, id: string): Promise<LanRow> {
    const row = await tx.getOptional<LanRow>(`SELECT id, title, authors_json, cover_uri, isbn, publisher, published_at,
      summary, note, status, page_count, pages_read, created_at, updated_at FROM reader_books WHERE owner_id = ? AND id = ? AND deleted_at IS NULL`, [this.workspaceId, id]);
    return row ?? missing();
  }
  private async sources(tx: SqlReadContext, kind: 'message' | 'discussion', id: string): Promise<LanSource[]> {
    const rows = await tx.getAll<LanRow>(`SELECT p.id, p.book_id, p.title, s.source_revision, p.source_revision AS current_revision
      FROM reader_${kind}_sources s LEFT JOIN reader_passages p ON p.id = s.passage_id AND p.owner_id = s.owner_id
      AND p.deleted_at IS NULL AND EXISTS (SELECT 1 FROM reader_books sb WHERE sb.id = p.book_id AND sb.owner_id = p.owner_id AND sb.deleted_at IS NULL)
      WHERE s.owner_id = ? AND s.${kind}_id = ? ORDER BY s.position ASC, s.id ASC`, [this.workspaceId, id]);
    return rows.map(projectSource);
  }
}

const PASSAGE_INDEX = `p.id, p.book_id, p.title, p.page_label, p.image_uri,
  substr(p.source_text, 1, 240) AS source_preview, substr(p.summary, 1, 240) AS summary_preview,
  p.source_revision, p.analysis_status, p.organization_status, p.created_at, p.updated_at`;
const DISCUSSION_JOINS = `LEFT JOIN reader_books b ON b.id = d.book_id AND b.owner_id = d.owner_id
  LEFT JOIN reader_folders f ON f.id = d.folder_id AND f.owner_id = d.owner_id AND f.deleted_at IS NULL`;
const lastMessage = (column: string) => `(SELECT ${column} FROM reader_messages lm WHERE lm.owner_id = d.owner_id AND lm.discussion_id = d.id AND lm.deleted_at IS NULL ORDER BY lm.created_at DESC, lm.id DESC LIMIT 1)`;
const DISCUSSION_INDEX = `d.id, d.title, d.book_id, b.title AS book_title, f.id AS folder_id, d.unread,
  COALESCE(${lastMessage('substr(lm.content, 1, 240)')}, '') AS last_message_preview,
  ${lastMessage('lm.status')} AS last_message_status, d.last_message_at, d.created_at, d.updated_at`;
const messageColumns = (full: boolean) => `m.id, m.discussion_id, d.title AS discussion_title, d.book_id, m.role,
  ${full ? 'm.content' : 'substr(m.content, 1, 2000)'} AS content, ${full ? '0' : 'length(m.content) > 2000'} AS has_more,
  m.status, m.favorite, m.created_at, m.updated_at`;

function passageIndex(row: LanRow): LanPassageIndex {
  return { id: text(row, 'id'), bookId: text(row, 'book_id'), title: text(row, 'title'), pageLabel: text(row, 'page_label'),
    imageId: mediaId('passage', text(row, 'id'), text(row, 'image_uri')), sourcePreview: text(row, 'source_preview'),
    summaryPreview: text(row, 'summary_preview'), sourceRevision: number(row, 'source_revision'),
    analysisStatus: text(row, 'analysis_status') as LanPassageIndex['analysisStatus'], organizationStatus: text(row, 'organization_status') as LanPassageIndex['organizationStatus'],
    createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at') };
}
function discussionIndex(row: LanRow): LanDiscussionIndex {
  return { id: text(row, 'id'), title: text(row, 'title'), bookId: nullable(row, 'book_id'), bookTitle: nullable(row, 'book_title'),
    folderId: nullable(row, 'folder_id'), unread: row.unread === 1, lastMessagePreview: text(row, 'last_message_preview'),
    lastMessageStatus: nullable(row, 'last_message_status') as LanDiscussionIndex['lastMessageStatus'], lastMessageAt: text(row, 'last_message_at'),
    createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at') };
}
function messageIndex(row: LanRow): LanMessageIndex {
  return { id: text(row, 'id'), discussionId: text(row, 'discussion_id'), discussionTitle: text(row, 'discussion_title'),
    bookId: nullable(row, 'book_id'), role: text(row, 'role') as LanMessageIndex['role'], content: text(row, 'content'),
    hasMoreContent: row.has_more === 1, status: text(row, 'status') as LanMessageIndex['status'], favorite: row.favorite === 1,
    createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at') };
}
function unavailableSource(revision: number | null): LanSource {
  return { passageId: null, bookId: null, title: '来源已不可用', sourceRevision: revision, currentRevision: null, state: 'unavailable' };
}
function projectSource(row: LanRow): LanSource {
  const revision = row.source_revision == null ? null : number(row, 'source_revision');
  if (!row.id) return unavailableSource(revision);
  const current = number(row, 'current_revision');
  return { passageId: text(row, 'id'), bookId: text(row, 'book_id'), title: text(row, 'title'), sourceRevision: revision,
    currentRevision: current, state: revision !== null && revision !== current ? 'updated' : 'available' };
}

function invalid(): never { throw new LanReadError('INVALID_REQUEST'); }

function parseCursor(value: string, status: string): Cursor {
  if (value.length > 1024) invalid();
  try {
    const cursor: unknown = JSON.parse(value);
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return invalid();
    const record = cursor as Record<string, unknown>;
    if (Object.keys(record).sort().join() !== 'id,rank,status,updatedAt' || record.status !== status
      || ![0, 1, 2].includes(Number(record.rank)) || typeof record.rank !== 'number'
      || typeof record.updatedAt !== 'string' || record.updatedAt.length > 64
      || typeof record.id !== 'string' || !record.id || record.id.length > 200) return invalid();
    return { status, rank: record.rank, updatedAt: record.updatedAt, id: record.id };
  } catch { return invalid(); }
}

function authorsOf(value: string): readonly string[] {
  try {
    const authors: unknown = JSON.parse(value);
    return Array.isArray(authors) ? authors.filter((author): author is string => typeof author === 'string').slice(0, 20) : [];
  } catch { return []; }
}
