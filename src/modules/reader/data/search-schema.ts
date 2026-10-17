/** The trigram index keeps normal Reader searches indexed while short queries use the literal fallback. */
export const READER_SEARCH_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS reader_search_fts_rows (
    fts_rowid INTEGER PRIMARY KEY,
    entity_key TEXT NOT NULL UNIQUE
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS reader_search_fts USING fts5(
    entity_key UNINDEXED,
    owner_id UNINDEXED,
    kind UNINDEXED,
    entity_id UNINDEXED,
    book_id UNINDEXED,
    title,
    subtitle,
    content,
    source_text UNINDEXED,
    image_uri UNINDEXED,
    sort_at UNINDEXED,
    tokenize = 'trigram',
    detail = 'none',
    columnsize = 0
  )`,
  `INSERT OR IGNORE INTO reader_search_fts_rows (fts_rowid, entity_key)
   SELECT rowid, entity_key FROM reader_search_fts`,
  `CREATE TRIGGER IF NOT EXISTS reader_search_books_insert AFTER INSERT ON reader_books BEGIN
    INSERT OR IGNORE INTO reader_search_fts_rows (entity_key) VALUES ('book:' || NEW.id);
    DELETE FROM reader_search_fts WHERE rowid = (SELECT fts_rowid FROM reader_search_fts_rows WHERE entity_key = 'book:' || NEW.id);
    INSERT INTO reader_search_fts (rowid, entity_key, owner_id, kind, entity_id, book_id, title, subtitle, content, source_text, image_uri, sort_at)
    SELECT fts_rowid, 'book:' || NEW.id, NEW.owner_id, 'book', NEW.id, NEW.id, NEW.title, NEW.authors_json,
      NEW.isbn || char(10) || NEW.summary || char(10) || NEW.note, '', NEW.cover_uri, NEW.updated_at
    FROM reader_search_fts_rows WHERE entity_key = 'book:' || NEW.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS reader_search_books_update AFTER UPDATE ON reader_books BEGIN
    DELETE FROM reader_search_fts WHERE rowid = (SELECT fts_rowid FROM reader_search_fts_rows WHERE entity_key = 'book:' || OLD.id);
    DELETE FROM reader_search_fts_rows WHERE entity_key = 'book:' || OLD.id;
    INSERT OR IGNORE INTO reader_search_fts_rows (entity_key) VALUES ('book:' || NEW.id);
    INSERT INTO reader_search_fts (rowid, entity_key, owner_id, kind, entity_id, book_id, title, subtitle, content, source_text, image_uri, sort_at)
    SELECT fts_rowid, 'book:' || NEW.id, NEW.owner_id, 'book', NEW.id, NEW.id, NEW.title, NEW.authors_json,
      NEW.isbn || char(10) || NEW.summary || char(10) || NEW.note, '', NEW.cover_uri, NEW.updated_at
    FROM reader_search_fts_rows WHERE entity_key = 'book:' || NEW.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS reader_search_books_delete AFTER DELETE ON reader_books BEGIN
    DELETE FROM reader_search_fts WHERE rowid = (SELECT fts_rowid FROM reader_search_fts_rows WHERE entity_key = 'book:' || OLD.id);
    DELETE FROM reader_search_fts_rows WHERE entity_key = 'book:' || OLD.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS reader_search_passages_insert AFTER INSERT ON reader_passages BEGIN
    INSERT OR IGNORE INTO reader_search_fts_rows (entity_key) VALUES ('passage:' || NEW.id);
    DELETE FROM reader_search_fts WHERE rowid = (SELECT fts_rowid FROM reader_search_fts_rows WHERE entity_key = 'passage:' || NEW.id);
    INSERT INTO reader_search_fts (rowid, entity_key, owner_id, kind, entity_id, book_id, title, subtitle, content, source_text, image_uri, sort_at)
    SELECT fts_rowid, 'passage:' || NEW.id, NEW.owner_id, 'passage', NEW.id, NEW.book_id, NEW.title, '',
      NEW.page_label || char(10) || NEW.summary || char(10) || NEW.source_text || char(10) || NEW.raw_source_text,
      NEW.source_text || char(10) || NEW.raw_source_text, NEW.image_uri, NEW.updated_at
    FROM reader_search_fts_rows WHERE entity_key = 'passage:' || NEW.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS reader_search_passages_update AFTER UPDATE ON reader_passages BEGIN
    DELETE FROM reader_search_fts WHERE rowid = (SELECT fts_rowid FROM reader_search_fts_rows WHERE entity_key = 'passage:' || OLD.id);
    DELETE FROM reader_search_fts_rows WHERE entity_key = 'passage:' || OLD.id;
    INSERT OR IGNORE INTO reader_search_fts_rows (entity_key) VALUES ('passage:' || NEW.id);
    INSERT INTO reader_search_fts (rowid, entity_key, owner_id, kind, entity_id, book_id, title, subtitle, content, source_text, image_uri, sort_at)
    SELECT fts_rowid, 'passage:' || NEW.id, NEW.owner_id, 'passage', NEW.id, NEW.book_id, NEW.title, '',
      NEW.page_label || char(10) || NEW.summary || char(10) || NEW.source_text || char(10) || NEW.raw_source_text,
      NEW.source_text || char(10) || NEW.raw_source_text, NEW.image_uri, NEW.updated_at
    FROM reader_search_fts_rows WHERE entity_key = 'passage:' || NEW.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS reader_search_passages_delete AFTER DELETE ON reader_passages BEGIN
    DELETE FROM reader_search_fts WHERE rowid = (SELECT fts_rowid FROM reader_search_fts_rows WHERE entity_key = 'passage:' || OLD.id);
    DELETE FROM reader_search_fts_rows WHERE entity_key = 'passage:' || OLD.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS reader_search_discussions_insert AFTER INSERT ON reader_discussions BEGIN
    INSERT OR IGNORE INTO reader_search_fts_rows (entity_key) VALUES ('discussion:' || NEW.id);
    DELETE FROM reader_search_fts WHERE rowid = (SELECT fts_rowid FROM reader_search_fts_rows WHERE entity_key = 'discussion:' || NEW.id);
    INSERT INTO reader_search_fts (rowid, entity_key, owner_id, kind, entity_id, book_id, title, subtitle, content, source_text, image_uri, sort_at)
    SELECT fts_rowid, 'discussion:' || NEW.id, NEW.owner_id, 'discussion', NEW.id, NEW.book_id, NEW.title, '',
      NEW.last_message_preview, '', '', NEW.updated_at
    FROM reader_search_fts_rows WHERE entity_key = 'discussion:' || NEW.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS reader_search_discussions_update AFTER UPDATE ON reader_discussions BEGIN
    DELETE FROM reader_search_fts WHERE rowid = (SELECT fts_rowid FROM reader_search_fts_rows WHERE entity_key = 'discussion:' || OLD.id);
    DELETE FROM reader_search_fts_rows WHERE entity_key = 'discussion:' || OLD.id;
    INSERT OR IGNORE INTO reader_search_fts_rows (entity_key) VALUES ('discussion:' || NEW.id);
    INSERT INTO reader_search_fts (rowid, entity_key, owner_id, kind, entity_id, book_id, title, subtitle, content, source_text, image_uri, sort_at)
    SELECT fts_rowid, 'discussion:' || NEW.id, NEW.owner_id, 'discussion', NEW.id, NEW.book_id, NEW.title, '',
      NEW.last_message_preview, '', '', NEW.updated_at
    FROM reader_search_fts_rows WHERE entity_key = 'discussion:' || NEW.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS reader_search_discussions_delete AFTER DELETE ON reader_discussions BEGIN
    DELETE FROM reader_search_fts WHERE rowid = (SELECT fts_rowid FROM reader_search_fts_rows WHERE entity_key = 'discussion:' || OLD.id);
    DELETE FROM reader_search_fts_rows WHERE entity_key = 'discussion:' || OLD.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS reader_search_messages_insert AFTER INSERT ON reader_messages BEGIN
    INSERT OR IGNORE INTO reader_search_fts_rows (entity_key) VALUES ('message:' || NEW.id);
    DELETE FROM reader_search_fts WHERE rowid = (SELECT fts_rowid FROM reader_search_fts_rows WHERE entity_key = 'message:' || NEW.id);
    INSERT INTO reader_search_fts (rowid, entity_key, owner_id, kind, entity_id, book_id, title, subtitle, content, source_text, image_uri, sort_at)
    SELECT fts_rowid, 'message:' || NEW.id, NEW.owner_id, 'message', NEW.id, NULL, '', '', NEW.content, '', '', NEW.updated_at
    FROM reader_search_fts_rows WHERE entity_key = 'message:' || NEW.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS reader_search_messages_update AFTER UPDATE ON reader_messages BEGIN
    DELETE FROM reader_search_fts WHERE rowid = (SELECT fts_rowid FROM reader_search_fts_rows WHERE entity_key = 'message:' || OLD.id);
    DELETE FROM reader_search_fts_rows WHERE entity_key = 'message:' || OLD.id;
    INSERT OR IGNORE INTO reader_search_fts_rows (entity_key) VALUES ('message:' || NEW.id);
    INSERT INTO reader_search_fts (rowid, entity_key, owner_id, kind, entity_id, book_id, title, subtitle, content, source_text, image_uri, sort_at)
    SELECT fts_rowid, 'message:' || NEW.id, NEW.owner_id, 'message', NEW.id, NULL, '', '', NEW.content, '', '', NEW.updated_at
    FROM reader_search_fts_rows WHERE entity_key = 'message:' || NEW.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS reader_search_messages_delete AFTER DELETE ON reader_messages BEGIN
    DELETE FROM reader_search_fts WHERE rowid = (SELECT fts_rowid FROM reader_search_fts_rows WHERE entity_key = 'message:' || OLD.id);
    DELETE FROM reader_search_fts_rows WHERE entity_key = 'message:' || OLD.id;
  END`,
  `INSERT OR IGNORE INTO reader_search_fts_rows (entity_key)
   SELECT 'book:' || b.id FROM reader_books b`,
  `INSERT INTO reader_search_fts (
    rowid, entity_key, owner_id, kind, entity_id, book_id, title, subtitle, content, source_text, image_uri, sort_at
  ) SELECT
    r.fts_rowid, 'book:' || b.id, b.owner_id, 'book', b.id, b.id, b.title, b.authors_json,
    b.isbn || char(10) || b.summary || char(10) || b.note,
    '', b.cover_uri, b.updated_at
  FROM reader_books b
  INNER JOIN reader_search_fts_rows r ON r.entity_key = 'book:' || b.id
  WHERE NOT EXISTS (SELECT 1 FROM reader_search_fts f WHERE f.rowid = r.fts_rowid)`,
  `INSERT OR IGNORE INTO reader_search_fts_rows (entity_key)
   SELECT 'passage:' || p.id FROM reader_passages p`,
  `INSERT INTO reader_search_fts (
    rowid, entity_key, owner_id, kind, entity_id, book_id, title, subtitle, content, source_text, image_uri, sort_at
  ) SELECT
    r.fts_rowid, 'passage:' || p.id, p.owner_id, 'passage', p.id, p.book_id, p.title, '',
    p.page_label || char(10) || p.summary || char(10) || p.source_text || char(10) || p.raw_source_text,
    p.source_text || char(10) || p.raw_source_text, p.image_uri, p.updated_at
  FROM reader_passages p
  INNER JOIN reader_search_fts_rows r ON r.entity_key = 'passage:' || p.id
  WHERE NOT EXISTS (SELECT 1 FROM reader_search_fts f WHERE f.rowid = r.fts_rowid)`,
  `INSERT OR IGNORE INTO reader_search_fts_rows (entity_key)
   SELECT 'discussion:' || d.id FROM reader_discussions d`,
  `INSERT INTO reader_search_fts (
    rowid, entity_key, owner_id, kind, entity_id, book_id, title, subtitle, content, source_text, image_uri, sort_at
  ) SELECT
    r.fts_rowid, 'discussion:' || d.id, d.owner_id, 'discussion', d.id, d.book_id, d.title, '',
    d.last_message_preview, '', '', d.updated_at
  FROM reader_discussions d
  INNER JOIN reader_search_fts_rows r ON r.entity_key = 'discussion:' || d.id
  WHERE NOT EXISTS (SELECT 1 FROM reader_search_fts f WHERE f.rowid = r.fts_rowid)`,
  `INSERT OR IGNORE INTO reader_search_fts_rows (entity_key)
   SELECT 'message:' || m.id FROM reader_messages m`,
  `INSERT INTO reader_search_fts (
    rowid, entity_key, owner_id, kind, entity_id, book_id, title, subtitle, content, source_text, image_uri, sort_at
  ) SELECT
    r.fts_rowid, 'message:' || m.id, m.owner_id, 'message', m.id, NULL, '', '', m.content, '', '', m.updated_at
  FROM reader_messages m
  INNER JOIN reader_search_fts_rows r ON r.entity_key = 'message:' || m.id
  WHERE NOT EXISTS (SELECT 1 FROM reader_search_fts f WHERE f.rowid = r.fts_rowid)`,
] as const;

export function canUseReaderSearchFts(value: string): boolean {
  return Array.from(value).length >= 3 && !/[\\%_]/u.test(value);
}

export function readerSearchFtsMatch(value: string): string {
  const characters = Array.from(value);
  return Array.from({ length: characters.length - 2 }, (_, index) =>
    `"${characters.slice(index, index + 3).join('').replace(/"/gu, '""')}"`,
  ).join(' AND ');
}
