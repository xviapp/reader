import { READER_SEARCH_SCHEMA_STATEMENTS } from './search-schema';

export const READER_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS reader_books (
    id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, title TEXT NOT NULL,
    authors_json TEXT NOT NULL, cover_uri TEXT NOT NULL, isbn TEXT NOT NULL,
    publisher TEXT NOT NULL, published_at TEXT NOT NULL, summary TEXT NOT NULL,
    note TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL,
    page_count INTEGER NOT NULL DEFAULT 0, pages_read INTEGER NOT NULL DEFAULT 0,
    role_id TEXT NOT NULL, custom_prompt TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS reader_books_owner_status_updated ON reader_books(owner_id, deleted_at, status, updated_at)',
  `CREATE TABLE IF NOT EXISTS reader_passages (
    id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, book_id TEXT NOT NULL,
    title TEXT NOT NULL, page_label TEXT NOT NULL, image_uri TEXT NOT NULL,
    raw_source_text TEXT NOT NULL, source_text TEXT NOT NULL,
    source_revision INTEGER NOT NULL, organized_source_revision INTEGER NOT NULL,
    ocr_script TEXT NOT NULL, ocr_blocks_json TEXT NOT NULL,
    summary TEXT NOT NULL, suggested_questions_json TEXT NOT NULL,
    analysis_status TEXT NOT NULL, analysis_error TEXT,
    organization_status TEXT NOT NULL, organization_error TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
    FOREIGN KEY(book_id) REFERENCES reader_books(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS reader_passages_owner_book_created ON reader_passages(owner_id, book_id, deleted_at, created_at)',
  `CREATE TABLE IF NOT EXISTS reader_passage_organization_candidates (
    id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, passage_id TEXT NOT NULL,
    source_revision INTEGER NOT NULL, source_text TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(owner_id, passage_id, source_revision),
    FOREIGN KEY(passage_id) REFERENCES reader_passages(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS reader_org_candidates_owner_passage ON reader_passage_organization_candidates(owner_id, passage_id, source_revision)',
  `CREATE TABLE IF NOT EXISTS reader_folders (
    id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL,
    position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS reader_folders_owner_position ON reader_folders(owner_id, deleted_at, position)',
  `CREATE TABLE IF NOT EXISTS reader_discussions (
    id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, title TEXT NOT NULL,
    book_id TEXT, passage_id TEXT, folder_id TEXT, unread INTEGER NOT NULL,
    last_message_at TEXT NOT NULL,
    last_message_preview TEXT NOT NULL DEFAULT '',
    last_message_status TEXT,
    latest_assistant_message_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY(book_id) REFERENCES reader_books(id) ON DELETE CASCADE,
    FOREIGN KEY(passage_id) REFERENCES reader_passages(id) ON DELETE SET NULL,
    FOREIGN KEY(folder_id) REFERENCES reader_folders(id) ON DELETE SET NULL
  )`,
  'CREATE INDEX IF NOT EXISTS reader_discussions_owner_recent ON reader_discussions(owner_id, deleted_at, last_message_at)',
  'CREATE INDEX IF NOT EXISTS reader_discussions_owner_folder ON reader_discussions(owner_id, folder_id, deleted_at, last_message_at)',
  `CREATE TABLE IF NOT EXISTS reader_discussion_sources (
    id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, discussion_id TEXT NOT NULL,
    passage_id TEXT NOT NULL, source_revision INTEGER NOT NULL, position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(owner_id, discussion_id, passage_id),
    FOREIGN KEY(discussion_id) REFERENCES reader_discussions(id) ON DELETE CASCADE,
    FOREIGN KEY(passage_id) REFERENCES reader_passages(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS reader_discussion_sources_owner_discussion ON reader_discussion_sources(owner_id, discussion_id, position)',
  `CREATE TABLE IF NOT EXISTS reader_messages (
    id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, discussion_id TEXT NOT NULL,
    role TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL,
    favorite INTEGER NOT NULL, collapsed INTEGER NOT NULL, error_message TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
    FOREIGN KEY(discussion_id) REFERENCES reader_discussions(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS reader_messages_owner_discussion_created ON reader_messages(owner_id, discussion_id, deleted_at, created_at)',
  'CREATE INDEX IF NOT EXISTS reader_messages_owner_favorite ON reader_messages(owner_id, favorite, deleted_at, updated_at)',
  'CREATE INDEX IF NOT EXISTS reader_messages_owner_favorite_page ON reader_messages(owner_id, favorite, deleted_at, updated_at DESC, id DESC)',
  `CREATE TABLE IF NOT EXISTS reader_message_sources (
    id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, message_id TEXT NOT NULL,
    passage_id TEXT NOT NULL, source_revision INTEGER NOT NULL, position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(owner_id, message_id, passage_id),
    FOREIGN KEY(message_id) REFERENCES reader_messages(id) ON DELETE CASCADE,
    FOREIGN KEY(passage_id) REFERENCES reader_passages(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS reader_message_sources_owner_message ON reader_message_sources(owner_id, message_id, position)',
  `CREATE TABLE IF NOT EXISTS reader_prompts (
    id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, stage TEXT NOT NULL,
    system_template TEXT NOT NULL, user_template TEXT NOT NULL,
    include_book INTEGER NOT NULL, include_source INTEGER NOT NULL,
    include_summary INTEGER NOT NULL, history_limit INTEGER NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(owner_id, stage)
  )`,
  `CREATE TABLE IF NOT EXISTS reader_roles (
    id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL,
    description TEXT NOT NULL, prompt TEXT NOT NULL, position INTEGER NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS reader_roles_owner_position ON reader_roles(owner_id, deleted_at, position)',
  `CREATE TABLE IF NOT EXISTS reader_reading_sessions (
    id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, book_id TEXT NOT NULL,
    started_at TEXT NOT NULL, ended_at TEXT NOT NULL, duration_ms INTEGER NOT NULL,
    start_page INTEGER, end_page INTEGER, created_at TEXT NOT NULL,
    FOREIGN KEY(book_id) REFERENCES reader_books(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS reader_reading_sessions_owner_book ON reader_reading_sessions(owner_id, book_id, started_at)',
  `CREATE TABLE IF NOT EXISTS reader_settings (
    id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL UNIQUE,
    ocr_script TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  ...READER_SEARCH_SCHEMA_STATEMENTS,
] as const;
