import type { LocalDatabase, SqlWriteContext } from '@/core/data/database-contract';
import type { AtomicWriteContext } from '@/core/data/atomic-write';
import { sqlWriteContextOf } from '@/core/data/atomic-write.internal';
import {
  asBoolean,
  createDatabaseId,
  decodeObjectArray,
  decodeStringArray,
  safeDataError,
} from '@/core/data/repository-utils';

import type { ReaderRepository, ReaderUnsubscribe } from '../application/ports';
import { canUseReaderSearchFts, readerSearchFtsMatch } from './search-schema';
import { DEFAULT_READER_PREFERENCES, DEFAULT_READER_PROMPTS, DEFAULT_READER_ROLES, defaultPromptDraft, defaultRoleDraft } from '../domain/defaults';
import type {
  ReaderAnalysisStatus,
  ReaderBackupSnapshot,
  ReaderBook,
  ReaderBookDraft,
  ReaderBookStatus,
  ReaderDiscussion,
  ReaderDiscussionSource,
  ReaderDiscussionDraft,
  ReaderFolder,
  ReaderMessage,
  ReaderMessageSource,
  ReaderMessageStatus,
  ReaderOrganizationStatus,
  ReaderOcrBlock,
  ReaderOcrScript,
  ReaderPassage,
  ReaderPassageOrganizationCandidate,
  ReaderPassageDraft,
  ReaderPassageIndex,
  ReaderPreferences,
  ReaderPrompt,
  ReaderPromptDraft,
  ReaderPromptStage,
  ReaderReadingSession,
  ReaderReadingSessionDraft,
  ReaderReadingSummary,
  ReaderRole,
  ReaderRoleDraft,
  ReaderSearchResult,
} from '../domain/model';
import { normalizeReaderAnalysisSummary } from '../domain/analysis';
import {
  assertReaderDiscussionContext,
  normalizeReaderBook,
  normalizeReaderDiscussion,
  normalizeReaderFolderName,
  normalizeReaderPassage,
  normalizeReaderPreferences,
  normalizeReaderPrompt,
  normalizeReaderRole,
} from '../domain/rules';

function normalizeOrganizedText(value: string): string {
  const paragraphs = value
    .replace(/\r\n?/gu, '\n')
    .split(/\n\s*\n+/gu)
    .map((paragraph) => paragraph.replace(/[ \t]+/gu, ' ').replace(/\n+/gu, ' ').trim())
    .filter(Boolean);
  return paragraphs.map((paragraph) => `　　${paragraph.replace(/^　+/u, '')}`).join('\n\n').slice(0, 500_000);
}

interface BookRow {
  id: string; title: string; authors_json: string; cover_uri: string; isbn: string;
  publisher: string; published_at: string; summary: string; note: string;
  status: ReaderBookStatus; progress: number; page_count: number; pages_read: number; role_id: string; custom_prompt: string;
  created_at: string; updated_at: string; deleted_at: string | null;
}

interface PassageRow {
  id: string; book_id: string; title: string; page_label: string; image_uri: string;
  raw_source_text: string; source_text: string; source_revision: number; organized_source_revision: number;
  ocr_script: ReaderOcrScript; ocr_blocks_json: string;
  summary: string; suggested_questions_json: string; analysis_status: ReaderAnalysisStatus;
  analysis_error: string | null; organization_status: ReaderOrganizationStatus;
  organization_error: string | null; created_at: string; updated_at: string; deleted_at: string | null;
}

interface OrganizationCandidateRow {
  id: string;
  passage_id: string;
  source_revision: number;
  source_text: string;
  created_at: string;
  updated_at: string;
}

interface PassageIndexRow {
  id: string; book_id: string; title: string; page_label: string; image_uri: string;
  source_preview: string; summary_preview: string; source_revision: number;
  analysis_status: ReaderAnalysisStatus; analysis_error: string | null;
  organization_status: ReaderOrganizationStatus; organization_error: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
}

interface FolderRow {
  id: string; name: string; position: number; created_at: string; updated_at: string; deleted_at: string | null;
}

interface DiscussionRow {
  id: string; title: string; book_id: string | null; passage_id: string | null;
  source_ids: string; passage_ids: string; passage_revisions: string; source_created_at: string;
  folder_id: string | null; unread: number | boolean; last_message_at: string;
  last_message_preview: string; last_message_status: ReaderMessageStatus | null;
  latest_assistant_message_id: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
}

interface DiscussionSourceRow {
  id: string;
  discussion_id: string;
  passage_id: string;
  source_revision: number;
  position: number;
  created_at: string;
}

interface MessageRow {
  id: string; discussion_id: string; role: 'user' | 'assistant'; content: string;
  status: ReaderMessageStatus; favorite: number | boolean; collapsed: number | boolean;
  error_message: string | null; created_at: string; updated_at: string; deleted_at: string | null;
}

interface MessageSourceRow {
  id: string;
  message_id: string;
  passage_id: string;
  source_revision: number;
  position: number;
  created_at: string;
}

interface SearchRow {
  kind: ReaderSearchResult['kind'];
  id: string;
  book_id: string | null;
  passage_id: string | null;
  discussion_id: string | null;
  title: string;
  subtitle: string;
  preview: string;
  image_uri: string;
  page_label: string;
  source_match: number | boolean;
}

interface PromptRow {
  id: string; stage: ReaderPromptStage; system_template: string; user_template: string;
  include_book: number | boolean; include_source: number | boolean; include_summary: number | boolean;
  history_limit: number; created_at: string; updated_at: string;
}

interface RoleRow {
  id: string; name: string; description: string; prompt: string; position: number;
  created_at: string; updated_at: string; deleted_at: string | null;
}

interface ReadingSessionRow {
  id: string; book_id: string; started_at: string; ended_at: string; duration_ms: number;
  start_page: number | null; end_page: number | null; created_at: string;
}

interface ReadingSummaryRow { session_count: number; total_ms: number; last_read_at: string | null }

interface SettingsRow {
  id: string; ocr_script: ReaderOcrScript;
  created_at: string; updated_at: string;
}

function mapBook(row: BookRow): ReaderBook {
  return {
    id: row.id,
    title: row.title,
    authors: decodeStringArray(row.authors_json, 20),
    coverUri: row.cover_uri,
    isbn: row.isbn,
    publisher: row.publisher,
    publishedAt: row.published_at,
    summary: row.summary,
    note: row.note,
    status: row.status,
    progress: Number(row.progress),
    pageCount: Number(row.page_count),
    pagesRead: Number(row.pages_read),
    roleId: row.role_id,
    customPrompt: row.custom_prompt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function parseOcrBlock(value: unknown): ReaderOcrBlock | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const block = value as Partial<ReaderOcrBlock>;
  const box = block.box;
  if (typeof block.text !== 'string' || !box || typeof box !== 'object') return null;
  if (typeof box.x !== 'number' || typeof box.y !== 'number' || typeof box.width !== 'number' || typeof box.height !== 'number') return null;
  return {
    text: block.text,
    confidence: typeof block.confidence === 'number' ? block.confidence : null,
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
  };
}

function mapPassage(row: PassageRow): ReaderPassage {
  return {
    id: row.id,
    bookId: row.book_id,
    title: row.title,
    pageLabel: row.page_label,
    imageUri: row.image_uri,
    rawSourceText: row.raw_source_text,
    sourceText: row.source_text,
    sourceRevision: Number(row.source_revision),
    organizedSourceRevision: Number(row.organized_source_revision),
    ocrScript: row.ocr_script,
    ocrBlocks: decodeObjectArray(row.ocr_blocks_json, parseOcrBlock, 2_000),
    summary: row.summary,
    suggestedQuestions: decodeStringArray(row.suggested_questions_json, 12),
    analysisStatus: row.analysis_status,
    analysisError: row.analysis_error,
    organizationStatus: row.organization_status,
    organizationError: row.organization_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapOrganizationCandidate(row: OrganizationCandidateRow): ReaderPassageOrganizationCandidate {
  return {
    id: row.id,
    passageId: row.passage_id,
    sourceRevision: Number(row.source_revision),
    sourceText: row.source_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPassageIndex(row: PassageIndexRow): ReaderPassageIndex {
  return {
    id: row.id,
    bookId: row.book_id,
    title: row.title,
    pageLabel: row.page_label,
    imageUri: row.image_uri,
    sourcePreview: row.source_preview,
    summaryPreview: row.summary_preview,
    sourceRevision: Number(row.source_revision),
    analysisStatus: row.analysis_status,
    analysisError: row.analysis_error,
    organizationStatus: row.organization_status,
    organizationError: row.organization_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapFolder(row: FolderRow): ReaderFolder {
  return { id: row.id, name: row.name, position: Number(row.position), createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at };
}

function mapDiscussion(row: DiscussionRow): ReaderDiscussion {
  const sourceIds = row.source_ids
    ? row.source_ids.split('|').filter(Boolean)
    : [];
  const passageIds = row.passage_ids
    ? row.passage_ids.split('|').filter(Boolean)
    : row.passage_id ? [row.passage_id] : [];
  const passageSourceRevisions = row.passage_revisions
    ? row.passage_revisions.split('|').map((value) => Number(value)).filter((value) => Number.isSafeInteger(value))
    : [];
  const sourceCreatedAt = row.source_created_at
    ? row.source_created_at.split('|').filter(Boolean)
    : [];
  const sources = passageIds.map((passageId, position) => ({
    id: sourceIds[position] ?? `reader-discussion-source:${row.id}:${passageId}`,
    discussionId: row.id,
    passageId,
    sourceRevision: passageSourceRevisions[position] ?? 0,
    position,
    createdAt: sourceCreatedAt[position] ?? row.created_at,
  }));
  return {
    id: row.id, title: row.title, bookId: row.book_id, passageId: row.passage_id,
    sources,
    passageIds,
    passageSourceRevisions,
    folderId: row.folder_id, unread: asBoolean(row.unread), lastMessagePreview: row.last_message_preview,
    lastMessageStatus: row.last_message_status, lastMessageAt: row.last_message_at,
    latestAssistantMessageId: row.latest_assistant_message_id,
    createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at,
  };
}

function mapDiscussionSource(row: DiscussionSourceRow): ReaderDiscussionSource {
  return {
    id: row.id,
    discussionId: row.discussion_id,
    passageId: row.passage_id,
    sourceRevision: Number(row.source_revision),
    position: Number(row.position),
    createdAt: row.created_at,
  };
}

function mapMessage(row: MessageRow): ReaderMessage {
  return {
    id: row.id, discussionId: row.discussion_id, role: row.role, content: row.content,
    status: row.status, favorite: asBoolean(row.favorite), collapsed: asBoolean(row.collapsed),
    errorMessage: row.error_message, createdAt: row.created_at, updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapMessageSource(row: MessageSourceRow): ReaderMessageSource {
  return {
    id: row.id,
    messageId: row.message_id,
    passageId: row.passage_id,
    sourceRevision: Number(row.source_revision),
    position: Number(row.position),
    createdAt: row.created_at,
  };
}

function mapSearchResult(row: SearchRow): ReaderSearchResult {
  return {
    kind: row.kind,
    id: row.id,
    bookId: row.book_id,
    passageId: row.passage_id,
    discussionId: row.discussion_id,
    title: row.title,
    subtitle: row.kind === 'book' ? decodeStringArray(row.subtitle, 20).join('、') : row.subtitle,
    preview: row.preview,
    imageUri: row.image_uri,
    pageLabel: row.page_label,
    sourceMatch: asBoolean(row.source_match),
  };
}

function mapPrompt(row: PromptRow): ReaderPrompt {
  return {
    id: row.id, stage: row.stage, systemTemplate: row.system_template, userTemplate: row.user_template,
    includeBook: asBoolean(row.include_book), includeSource: asBoolean(row.include_source),
    includeSummary: asBoolean(row.include_summary), historyLimit: Number(row.history_limit),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapRole(row: RoleRow): ReaderRole {
  return {
    id: row.id, name: row.name, description: row.description, prompt: row.prompt,
    position: Number(row.position), createdAt: row.created_at, updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapReadingSession(row: ReadingSessionRow): ReaderReadingSession {
  return {
    id: row.id, bookId: row.book_id, startedAt: row.started_at, endedAt: row.ended_at,
    durationMs: Number(row.duration_ms), startPage: optionalPage(row.start_page), endPage: optionalPage(row.end_page),
    createdAt: row.created_at,
  };
}

function mapReadingSummary(row: ReadingSummaryRow | undefined): ReaderReadingSummary {
  return { sessionCount: Number(row?.session_count ?? 0), totalMs: Number(row?.total_ms ?? 0), lastReadAt: row?.last_read_at ?? null };
}

function readingDurationOf(draft: ReaderReadingSessionDraft): number {
  const durationMs = Date.parse(draft.endedAt) - Date.parse(draft.startedAt);
  if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error('阅读时间无效');
  return durationMs;
}

function optionalPage(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function mapSettings(row: SettingsRow): ReaderPreferences {
  return {
    id: row.id, ocrScript: row.ocr_script,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export class LocalReaderRepository implements ReaderRepository {
  constructor(
    private readonly database: LocalDatabase,
    private readonly workspaceId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureDefaults(): Promise<void> {
    await this.database.writeTransaction(async (transaction) => {
      await this.ensureDefaultsInTransaction(transaction);
    });
  }

  private async ensureDefaultsInTransaction(transaction: SqlWriteContext): Promise<void> {
    const now = this.timestamp();
    await transaction.execute(
      `INSERT OR IGNORE INTO reader_settings (
        id, owner_id, ocr_script, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)`,
      ['reader-settings-local', this.workspaceId, DEFAULT_READER_PREFERENCES.ocrScript, now, now],
    );
    for (const stage of ['analysis', 'organize', 'discussion', 'follow-up'] as const) {
      const prompt = DEFAULT_READER_PROMPTS[stage];
      await transaction.execute(
        `INSERT OR IGNORE INTO reader_prompts (
          id, owner_id, stage, system_template, user_template, include_book,
          include_source, include_summary, history_limit, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [`reader-prompt-${stage}`, this.workspaceId, stage, prompt.systemTemplate, prompt.userTemplate,
          prompt.includeBook ? 1 : 0, prompt.includeSource ? 1 : 0, prompt.includeSummary ? 1 : 0,
          prompt.historyLimit, now, now],
      );
    }
    for (const [position, role] of DEFAULT_READER_ROLES.entries()) {
      await transaction.execute(
        `INSERT OR IGNORE INTO reader_roles (
          id, owner_id, name, description, prompt, position, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [`reader-role-${role[0]}`, this.workspaceId, role[1], role[2], role[3], position, now, now],
      );
    }
  }

  async recoverInterruptedWork(): Promise<void> {
    const now = this.timestamp();
    await this.database.writeTransaction(async (transaction) => {
      const interruptedDiscussions = await transaction.getAll<{ discussion_id: string }>(
        `SELECT DISTINCT m.discussion_id FROM reader_messages m
         INNER JOIN reader_discussions d ON d.id = m.discussion_id AND d.owner_id = m.owner_id
         WHERE m.owner_id = ? AND m.status = 'pending' AND m.deleted_at IS NULL
           AND d.deleted_at IS NULL`,
        [this.workspaceId],
      );
      await transaction.execute(
        `UPDATE reader_passages SET analysis_status = 'interrupted',
           analysis_error = '应用在分析完成前退出，请重试', updated_at = ?
         WHERE owner_id = ? AND analysis_status = 'running'`,
        [now, this.workspaceId],
      );
      await transaction.execute(
        `UPDATE reader_passages SET organization_status = 'interrupted',
           organization_error = '应用在整理完成前退出，可以继续任务', updated_at = ?
         WHERE owner_id = ? AND organization_status = 'running'`,
        [now, this.workspaceId],
      );
      await transaction.execute(
        `UPDATE reader_messages SET status = 'interrupted',
           error_message = '应用在回答完成前退出，请重试', updated_at = ?
         WHERE owner_id = ? AND status = 'pending' AND deleted_at IS NULL
           AND discussion_id IN (
             SELECT id FROM reader_discussions WHERE owner_id = ? AND deleted_at IS NULL
           )`,
        [now, this.workspaceId, this.workspaceId],
      );
      for (const discussion of interruptedDiscussions) {
        await this.syncDiscussionProjection(transaction, discussion.discussion_id, now);
      }
    });
  }

  async createBackupSnapshot(): Promise<ReaderBackupSnapshot> {
    const [books, passages, organizationCandidates, folders, discussions, discussionSources, messages, messageSources, prompts, roles, readingSessions, settings] = await Promise.all([
      this.database.getAll<BookRow>(`SELECT id, title, authors_json, cover_uri, isbn, publisher, published_at,
              summary, note, status, progress, page_count, pages_read, role_id, custom_prompt, created_at, updated_at, deleted_at
       FROM reader_books WHERE owner_id = ?`, [this.workspaceId]),
      this.database.getAll<PassageRow>(`SELECT id, book_id, title, page_label, image_uri, raw_source_text, source_text,
              source_revision, organized_source_revision, ocr_script, ocr_blocks_json,
              summary, suggested_questions_json, analysis_status, analysis_error,
              organization_status, organization_error, created_at, updated_at, deleted_at
       FROM reader_passages WHERE owner_id = ?`, [this.workspaceId]),
      this.database.getAll<OrganizationCandidateRow>(`SELECT id, passage_id, source_revision, source_text, created_at, updated_at
       FROM reader_passage_organization_candidates WHERE owner_id = ?`, [this.workspaceId]),
      this.database.getAll<FolderRow>(`SELECT id, name, position, created_at, updated_at, deleted_at
       FROM reader_folders WHERE owner_id = ?`, [this.workspaceId]),
      this.database.getAll<DiscussionRow>(`SELECT d.id, d.title, d.book_id, d.passage_id,
              COALESCE((SELECT GROUP_CONCAT(ordered.id, '|') FROM (
                SELECT ds.id FROM reader_discussion_sources ds
                WHERE ds.owner_id = d.owner_id AND ds.discussion_id = d.id ORDER BY ds.position ASC, ds.id ASC
              ) ordered), '') AS source_ids,
              COALESCE((SELECT GROUP_CONCAT(ordered.passage_id, '|') FROM (
                SELECT ds.passage_id FROM reader_discussion_sources ds
                WHERE ds.owner_id = d.owner_id AND ds.discussion_id = d.id ORDER BY ds.position ASC, ds.id ASC
              ) ordered), '') AS passage_ids,
              COALESCE((SELECT GROUP_CONCAT(ordered.source_revision, '|') FROM (
                SELECT ds.source_revision FROM reader_discussion_sources ds
                WHERE ds.owner_id = d.owner_id AND ds.discussion_id = d.id ORDER BY ds.position ASC, ds.id ASC
              ) ordered), '') AS passage_revisions,
              COALESCE((SELECT GROUP_CONCAT(ordered.created_at, '|') FROM (
                SELECT ds.created_at FROM reader_discussion_sources ds
                WHERE ds.owner_id = d.owner_id AND ds.discussion_id = d.id ORDER BY ds.position ASC, ds.id ASC
              ) ordered), '') AS source_created_at,
              d.folder_id, d.unread, d.last_message_at,
              d.last_message_preview, d.last_message_status, d.latest_assistant_message_id,
              d.created_at, d.updated_at, d.deleted_at FROM reader_discussions d WHERE d.owner_id = ?`, [this.workspaceId]),
      this.database.getAll<DiscussionSourceRow>(`SELECT id, discussion_id, passage_id, source_revision, position, created_at
       FROM reader_discussion_sources WHERE owner_id = ? ORDER BY discussion_id ASC, position ASC, id ASC`, [this.workspaceId]),
      this.database.getAll<MessageRow>(`SELECT id, discussion_id, role, content, status, favorite, collapsed,
              error_message, created_at, updated_at, deleted_at FROM reader_messages WHERE owner_id = ?`, [this.workspaceId]),
      this.database.getAll<MessageSourceRow>(`SELECT id, message_id, passage_id, source_revision, position, created_at
       FROM reader_message_sources WHERE owner_id = ? ORDER BY message_id ASC, position ASC`, [this.workspaceId]),
      this.database.getAll<PromptRow>(`SELECT id, stage, system_template, user_template, include_book, include_source,
              include_summary, history_limit, created_at, updated_at FROM reader_prompts WHERE owner_id = ?`, [this.workspaceId]),
      this.database.getAll<RoleRow>(`SELECT id, name, description, prompt, position, created_at, updated_at, deleted_at
       FROM reader_roles WHERE owner_id = ?`, [this.workspaceId]),
      this.database.getAll<ReadingSessionRow>(`SELECT id, book_id, started_at, ended_at, duration_ms, start_page, end_page, created_at
       FROM reader_reading_sessions WHERE owner_id = ? ORDER BY started_at ASC, id ASC`, [this.workspaceId]),
      this.database.getAll<SettingsRow>(`SELECT id, ocr_script, created_at, updated_at FROM reader_settings WHERE owner_id = ?`, [this.workspaceId]),
    ]);
    return {
      formatVersion: 1,
      createdAt: this.timestamp(),
      books: books.map(mapBook),
      passages: passages.map(mapPassage),
      organizationCandidates: organizationCandidates.map(mapOrganizationCandidate),
      folders: folders.map(mapFolder),
      discussions: discussions.map(mapDiscussion),
      discussionSources: discussionSources.map(mapDiscussionSource),
      messages: messages.map(mapMessage),
      messageSources: messageSources.map(mapMessageSource),
      prompts: prompts.map(mapPrompt),
      roles: roles.map(mapRole),
      readingSessions: readingSessions.map(mapReadingSession),
      preferences: settings[0] ? mapSettings(settings[0]) : null,
    };
  }

  async restoreBackupSnapshot(snapshot: ReaderBackupSnapshot): Promise<void> {
    if (snapshot.formatVersion !== 1) throw new Error('不支持的 Reader 备份版本');
    await this.database.writeTransaction(async (transaction) => {
      const existing = await transaction.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM reader_books WHERE owner_id = ?',
        [this.workspaceId],
      );
      if (Number(existing.count) > 0) throw new Error('当前设备已有 Reader 数据，请先清空后再恢复');
      await this.executeRestoreTransaction(transaction, snapshot);
    });
  }

  async replaceBackupSnapshot(snapshot: ReaderBackupSnapshot): Promise<void> {
    if (snapshot.formatVersion !== 1) throw new Error('不支持的 Reader 备份版本');
    await this.database.writeTransaction(async (transaction) => {
      await this.executeRestoreTransaction(transaction, snapshot);
    });
  }

  async clearAllData(): Promise<void> {
    await this.database.writeTransaction(async (transaction) => {
      await this.clearWorkspaceData(transaction);
      await this.ensureDefaultsInTransaction(transaction);
    });
  }

  private async clearWorkspaceData(transaction: SqlWriteContext): Promise<void> {
    await transaction.execute('DELETE FROM ai_tasks WHERE owner_id = ?', [this.workspaceId]);
    await transaction.execute('DELETE FROM reader_message_sources WHERE owner_id = ?', [this.workspaceId]);
    await transaction.execute('DELETE FROM reader_discussion_sources WHERE owner_id = ?', [this.workspaceId]);
    await transaction.execute('DELETE FROM reader_messages WHERE owner_id = ?', [this.workspaceId]);
    await transaction.execute('DELETE FROM reader_discussions WHERE owner_id = ?', [this.workspaceId]);
    await transaction.execute('DELETE FROM reader_passage_organization_candidates WHERE owner_id = ?', [this.workspaceId]);
    await transaction.execute('DELETE FROM reader_passages WHERE owner_id = ?', [this.workspaceId]);
    await transaction.execute('DELETE FROM reader_reading_sessions WHERE owner_id = ?', [this.workspaceId]);
    await transaction.execute('DELETE FROM reader_books WHERE owner_id = ?', [this.workspaceId]);
    await transaction.execute('DELETE FROM reader_folders WHERE owner_id = ?', [this.workspaceId]);
    await transaction.execute('DELETE FROM reader_roles WHERE owner_id = ?', [this.workspaceId]);
    await transaction.execute('DELETE FROM reader_prompts WHERE owner_id = ?', [this.workspaceId]);
    await transaction.execute('DELETE FROM reader_settings WHERE owner_id = ?', [this.workspaceId]);
  }

  private async executeRestoreTransaction(transaction: SqlWriteContext, snapshot: ReaderBackupSnapshot): Promise<void> {
    const now = this.timestamp();
    await this.clearWorkspaceData(transaction);

      for (const role of snapshot.roles) {
        await transaction.execute(
          `INSERT INTO reader_roles (id, owner_id, name, description, prompt, position, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [role.id, this.workspaceId, role.name, role.description, role.prompt, role.position, role.createdAt || now, role.updatedAt || now, role.deletedAt],
        );
      }
      for (const prompt of snapshot.prompts) {
        await transaction.execute(
          `INSERT INTO reader_prompts (id, owner_id, stage, system_template, user_template, include_book,
             include_source, include_summary, history_limit, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [prompt.id, this.workspaceId, prompt.stage, prompt.systemTemplate, prompt.userTemplate, prompt.includeBook ? 1 : 0,
            prompt.includeSource ? 1 : 0, prompt.includeSummary ? 1 : 0, prompt.historyLimit, prompt.createdAt || now, prompt.updatedAt || now],
        );
      }
      for (const folder of snapshot.folders) {
        await transaction.execute(
          `INSERT INTO reader_folders (id, owner_id, name, position, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [folder.id, this.workspaceId, folder.name, folder.position, folder.createdAt || now, folder.updatedAt || now, folder.deletedAt],
        );
      }
      for (const book of snapshot.books) {
        await transaction.execute(
          `INSERT INTO reader_books (id, owner_id, title, authors_json, cover_uri, isbn, publisher, published_at,
             summary, note, status, progress, page_count, pages_read, role_id, custom_prompt, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          // Backups made before page counts existed restore with unknown pages.
          [book.id, this.workspaceId, book.title, JSON.stringify(book.authors), book.coverUri, book.isbn, book.publisher,
            book.publishedAt, book.summary, book.note, book.status, book.progress, book.pageCount ?? 0, book.pagesRead ?? 0, book.roleId, book.customPrompt,
            book.createdAt || now, book.updatedAt || now, book.deletedAt],
        );
      }
      for (const passage of snapshot.passages) {
        const analysisInterrupted = passage.analysisStatus === 'running';
        const organizationInterrupted = passage.organizationStatus === 'running' || passage.organizationStatus === 'queued';
        await transaction.execute(
          `INSERT INTO reader_passages (id, owner_id, book_id, title, page_label, image_uri, raw_source_text, source_text,
             source_revision, organized_source_revision, ocr_script, ocr_blocks_json, summary, suggested_questions_json,
             analysis_status, analysis_error, organization_status, organization_error, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [passage.id, this.workspaceId, passage.bookId, passage.title, passage.pageLabel, passage.imageUri, passage.rawSourceText,
            passage.sourceText, passage.sourceRevision, passage.organizedSourceRevision, passage.ocrScript, JSON.stringify(passage.ocrBlocks),
            passage.summary, JSON.stringify(passage.suggestedQuestions), analysisInterrupted ? 'interrupted' : passage.analysisStatus,
            analysisInterrupted ? '备份前任务未完成，请重试' : passage.analysisError,
            organizationInterrupted ? 'interrupted' : passage.organizationStatus,
            organizationInterrupted ? '备份前任务未完成，请重试' : passage.organizationError,
            passage.createdAt || now, passage.updatedAt || now, passage.deletedAt],
        );
      }
      for (const candidate of snapshot.organizationCandidates ?? []) {
        await transaction.execute(
          `INSERT INTO reader_passage_organization_candidates (id, owner_id, passage_id, source_revision, source_text, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [candidate.id, this.workspaceId, candidate.passageId, candidate.sourceRevision, candidate.sourceText,
            candidate.createdAt || now, candidate.updatedAt || now],
        );
      }
      for (const discussion of snapshot.discussions) {
        await transaction.execute(
          `INSERT INTO reader_discussions (id, owner_id, title, book_id, passage_id, folder_id, unread, last_message_at,
             last_message_preview, last_message_status, latest_assistant_message_id, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [discussion.id, this.workspaceId, discussion.title, discussion.bookId, discussion.passageId, discussion.folderId,
            discussion.unread ? 1 : 0, discussion.lastMessageAt, discussion.lastMessagePreview, discussion.lastMessageStatus,
            discussion.latestAssistantMessageId ?? null, discussion.createdAt || now, discussion.updatedAt || now, discussion.deletedAt],
        );
        const snapshotSources = snapshot.discussionSources?.filter((source) => source.discussionId === discussion.id);
        const sources = snapshotSources?.length
          ? snapshotSources
          : discussion.sources?.length ? discussion.sources : null;
        if (sources) {
          for (const source of [...sources].sort((left, right) => left.position - right.position)) {
            const passageId = source.passageId;
            const passage = snapshot.passages.find((item) => item.id === passageId);
            if (!passage) continue;
            const sourceRevision = source.sourceRevision > 0 ? source.sourceRevision : passage.sourceRevision;
            await transaction.execute(
              `INSERT INTO reader_discussion_sources (
                id, owner_id, discussion_id, passage_id, source_revision, position, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [source.id || await createDatabaseId(transaction, 'reader-discussion-source'), this.workspaceId, discussion.id,
                passageId, sourceRevision, source.position, source.createdAt || discussion.createdAt || now],
            );
          }
        } else {
          const sourceIds = discussion.passageIds?.length
            ? discussion.passageIds
            : discussion.passageId ? [discussion.passageId] : [];
          for (const [position, passageId] of sourceIds.entries()) {
            const passage = snapshot.passages.find((item) => item.id === passageId);
            if (!passage) continue;
            const sourceRevision = discussion.passageSourceRevisions?.[position] ?? passage.sourceRevision;
            await transaction.execute(
              `INSERT INTO reader_discussion_sources (
                id, owner_id, discussion_id, passage_id, source_revision, position, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [await createDatabaseId(transaction, 'reader-discussion-source'), this.workspaceId, discussion.id,
                passageId, sourceRevision, position, discussion.createdAt || now],
            );
          }
        }
      }
      for (const message of snapshot.messages) {
        const interrupted = message.status === 'pending';
        await transaction.execute(
          `INSERT INTO reader_messages (id, owner_id, discussion_id, role, content, status, favorite, collapsed,
             error_message, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [message.id, this.workspaceId, message.discussionId, message.role, message.content, interrupted ? 'interrupted' : message.status,
            message.favorite ? 1 : 0, message.collapsed ? 1 : 0, interrupted ? '备份前回答未完成，请重试' : message.errorMessage,
            message.createdAt || now, message.updatedAt || now, message.deletedAt],
        );
      }
      for (const source of snapshot.messageSources ?? []) {
        await transaction.execute(
          `INSERT INTO reader_message_sources (
            id, owner_id, message_id, passage_id, source_revision, position, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [source.id, this.workspaceId, source.messageId, source.passageId, source.sourceRevision,
            source.position, source.createdAt || now],
        );
      }
      for (const session of snapshot.readingSessions ?? []) {
        await transaction.execute(
          `INSERT INTO reader_reading_sessions (id, owner_id, book_id, started_at, ended_at, duration_ms, start_page, end_page, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [session.id, this.workspaceId, session.bookId, session.startedAt, session.endedAt, session.durationMs,
            session.startPage, session.endPage, session.createdAt || now],
        );
      }
      const preferences = snapshot.preferences ?? {
        id: 'reader-settings-local', ocrScript: 'auto' as ReaderPreferences['ocrScript'], createdAt: now, updatedAt: now,
      };
      await transaction.execute(
        'INSERT INTO reader_settings (id, owner_id, ocr_script, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [preferences.id, this.workspaceId, preferences.ocrScript, preferences.createdAt || now, preferences.updatedAt || now],
      );
  }

  watchBooks(includeDeleted: boolean, listener: (items: readonly ReaderBook[]) => void, onError: (error: Error) => void): ReaderUnsubscribe {
    return this.watch(
      `SELECT id, title, authors_json, cover_uri, isbn, publisher, published_at, summary,
              note, status, progress, page_count, pages_read, role_id, custom_prompt, created_at, updated_at, deleted_at
       FROM reader_books WHERE owner_id = ? AND (? = 1 OR deleted_at IS NULL)
       ORDER BY CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END,
                CASE status WHEN 'reading' THEN 0 WHEN 'unread' THEN 1 ELSE 2 END,
                updated_at DESC, id ASC`,
      [this.workspaceId, includeDeleted ? 1 : 0], mapBook, listener, onError, '书架读取失败',
    );
  }

  watchPassages(bookId: string | null, includeDeleted: boolean, listener: (items: readonly ReaderPassage[]) => void, onError: (error: Error) => void): ReaderUnsubscribe {
    return this.watch(
      `SELECT id, book_id, title, page_label, image_uri, raw_source_text, source_text,
              source_revision, organized_source_revision, ocr_script, ocr_blocks_json,
              summary, suggested_questions_json, analysis_status, analysis_error,
              organization_status, organization_error, created_at, updated_at, deleted_at
       FROM reader_passages
       WHERE owner_id = ? AND (? IS NULL OR book_id = ?) AND (? = 1 OR deleted_at IS NULL)
       ORDER BY created_at DESC, id DESC`,
      [this.workspaceId, bookId, bookId, includeDeleted ? 1 : 0], mapPassage, listener, onError, '摘录读取失败',
    );
  }

  watchPassageIndex(includeDeleted: boolean, listener: (items: readonly ReaderPassageIndex[]) => void, onError: (error: Error) => void): ReaderUnsubscribe {
    return this.watch(
      `SELECT id, book_id, title, page_label, image_uri,
              substr(source_text, 1, 320) AS source_preview,
              substr(summary, 1, 320) AS summary_preview,
              source_revision, analysis_status, analysis_error, organization_status, organization_error,
              created_at, updated_at, deleted_at
       FROM reader_passages
       WHERE owner_id = ? AND (? = 1 OR deleted_at IS NULL)
       ORDER BY created_at DESC, id DESC`,
      [this.workspaceId, includeDeleted ? 1 : 0], mapPassageIndex, listener, onError, '摘录索引读取失败',
    );
  }

  watchPassage(id: string, listener: (item: ReaderPassage | null) => void, onError: (error: Error) => void): ReaderUnsubscribe {
    const controller = new AbortController();
    this.database.watch<PassageRow>(
      `SELECT id, book_id, title, page_label, image_uri, raw_source_text, source_text,
              source_revision, organized_source_revision, ocr_script, ocr_blocks_json,
              summary, suggested_questions_json, analysis_status, analysis_error,
              organization_status, organization_error, created_at, updated_at, deleted_at
       FROM reader_passages WHERE id = ? AND owner_id = ?`,
      [id, this.workspaceId],
      {
        onResult: (rows) => listener(rows[0] ? mapPassage(rows[0]) : null),
        onError: (error) => onError(safeDataError(error, '摘录读取失败')),
      },
      { signal: controller.signal, triggerImmediate: true },
    );
    return () => controller.abort();
  }

  watchOrganizationCandidate(
    passageId: string,
    listener: (item: ReaderPassageOrganizationCandidate | null) => void,
    onError: (error: Error) => void,
  ): ReaderUnsubscribe {
    const controller = new AbortController();
    this.database.watch<OrganizationCandidateRow>(
      `SELECT c.id, c.passage_id, c.source_revision, c.source_text, c.created_at, c.updated_at
       FROM reader_passage_organization_candidates c
       INNER JOIN reader_passages p ON p.id = c.passage_id AND p.owner_id = c.owner_id
         AND p.source_revision = c.source_revision AND p.deleted_at IS NULL
       WHERE c.passage_id = ? AND c.owner_id = ?
       ORDER BY c.updated_at DESC, c.id DESC
       LIMIT 1`,
      [passageId, this.workspaceId],
      {
        onResult: (rows) => listener(rows[0] ? mapOrganizationCandidate(rows[0]) : null),
        onError: (error) => onError(safeDataError(error, 'AI 整理候选读取失败')),
      },
      { signal: controller.signal, triggerImmediate: true },
    );
    return () => controller.abort();
  }

  watchFolders(listener: (items: readonly ReaderFolder[]) => void, onError: (error: Error) => void): ReaderUnsubscribe {
    return this.watch(
      `SELECT id, name, position, created_at, updated_at, deleted_at FROM reader_folders
       WHERE owner_id = ? AND deleted_at IS NULL ORDER BY position ASC, name ASC`,
      [this.workspaceId], mapFolder, listener, onError, '讨论文件夹读取失败',
    );
  }

  watchDiscussions(includeDeleted: boolean, listener: (items: readonly ReaderDiscussion[]) => void, onError: (error: Error) => void): ReaderUnsubscribe {
    return this.watch(
      `SELECT d.id, d.title, d.book_id, d.passage_id,
              COALESCE((SELECT GROUP_CONCAT(ordered.id, '|') FROM (
                SELECT ds.id FROM reader_discussion_sources ds
                WHERE ds.owner_id = d.owner_id AND ds.discussion_id = d.id ORDER BY ds.position ASC, ds.id ASC
              ) ordered), '') AS source_ids,
              COALESCE((SELECT GROUP_CONCAT(ordered.passage_id, '|') FROM (
                SELECT ds.passage_id FROM reader_discussion_sources ds
                WHERE ds.owner_id = d.owner_id AND ds.discussion_id = d.id ORDER BY ds.position ASC, ds.id ASC
              ) ordered), '') AS passage_ids,
              COALESCE((SELECT GROUP_CONCAT(ordered.source_revision, '|') FROM (
                SELECT ds.source_revision FROM reader_discussion_sources ds
                WHERE ds.owner_id = d.owner_id AND ds.discussion_id = d.id ORDER BY ds.position ASC, ds.id ASC
              ) ordered), '') AS passage_revisions,
              COALESCE((SELECT GROUP_CONCAT(ordered.created_at, '|') FROM (
                SELECT ds.created_at FROM reader_discussion_sources ds
                WHERE ds.owner_id = d.owner_id AND ds.discussion_id = d.id ORDER BY ds.position ASC, ds.id ASC
              ) ordered), '') AS source_created_at,
              d.folder_id, d.unread, d.last_message_at,
              d.last_message_preview, d.last_message_status, d.latest_assistant_message_id,
              d.created_at, d.updated_at, d.deleted_at
       FROM reader_discussions d
       WHERE d.owner_id = ? AND (? = 1 OR d.deleted_at IS NULL)
       ORDER BY d.last_message_at DESC, d.id DESC`,
      [this.workspaceId, includeDeleted ? 1 : 0], mapDiscussion, listener, onError, '讨论读取失败',
    );
  }

  watchMessages(discussionId: string, listener: (items: readonly ReaderMessage[]) => void, onError: (error: Error) => void): ReaderUnsubscribe {
    return this.watch(
      `SELECT id, discussion_id, role, content, status, favorite, collapsed,
              error_message, created_at, updated_at, deleted_at FROM reader_messages
       WHERE owner_id = ? AND discussion_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`,
      [this.workspaceId, discussionId], mapMessage, listener, onError, '讨论消息读取失败',
    );
  }

  async listMessages(discussionId: string): Promise<readonly ReaderMessage[]> {
    const rows = await this.database.getAll<MessageRow>(
      `SELECT id, discussion_id, role, content, status, favorite, collapsed,
              error_message, created_at, updated_at, deleted_at FROM reader_messages
       WHERE owner_id = ? AND discussion_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`,
      [this.workspaceId, discussionId],
    );
    return rows.map(mapMessage);
  }

  watchFavoriteMessages(listener: (items: readonly ReaderMessage[]) => void, onError: (error: Error) => void): ReaderUnsubscribe {
    return this.watch(
      `SELECT id, discussion_id, role, content, status, favorite, collapsed,
              error_message, created_at, updated_at, deleted_at FROM reader_messages
       WHERE owner_id = ? AND favorite = 1 AND deleted_at IS NULL
       ORDER BY updated_at DESC, id DESC`,
      [this.workspaceId], mapMessage, listener, onError, '收藏读取失败',
    );
  }

  async search(query: string, kind: ReaderSearchResult['kind'] | 'all' = 'all', bookId: string | null = null, limit = 60, offset = 0): Promise<readonly ReaderSearchResult[]> {
    const value = query.trim();
    if (!value) return [];
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));
    if (canUseReaderSearchFts(value)) return this.searchWithFts(value, kind, bookId, safeLimit, safeOffset);
    const pattern = `%${value.replace(/[\\%_]/gu, '\\$&')}%`;
    const clauses: string[] = [];
    const parameters: unknown[] = [];
    const add = (sql: string, values: readonly unknown[]) => {
      clauses.push(sql);
      parameters.push(...values);
    };
    if (kind === 'all' || kind === 'book') {
      add(`SELECT 'book' AS kind, b.id AS id, b.id AS book_id, NULL AS passage_id, NULL AS discussion_id,
              b.title AS title, b.authors_json AS subtitle, COALESCE(NULLIF(b.summary, ''), NULLIF(b.note, ''), '') AS preview,
              b.cover_uri AS image_uri, '' AS page_label, 0 AS source_match, b.updated_at AS sort_at
           FROM reader_books b
           WHERE b.owner_id = ? AND b.deleted_at IS NULL AND (? IS NULL OR b.id = ?)
             AND (LOWER(b.title) LIKE LOWER(?) ESCAPE '\\' OR LOWER(b.authors_json) LIKE LOWER(?) ESCAPE '\\'
                  OR LOWER(b.isbn) LIKE LOWER(?) ESCAPE '\\' OR LOWER(b.summary) LIKE LOWER(?) ESCAPE '\\'
                  OR LOWER(b.note) LIKE LOWER(?) ESCAPE '\\')`,
        [this.workspaceId, bookId, bookId, pattern, pattern, pattern, pattern, pattern]);
    }
    if (kind === 'all' || kind === 'passage') {
      add(`SELECT 'passage' AS kind, p.id AS id, p.book_id, p.id AS passage_id, NULL AS discussion_id,
              COALESCE(NULLIF(p.title, ''), p.page_label, '未命名摘录') AS title,
              b.title AS subtitle, COALESCE(NULLIF(p.summary, ''), '') AS preview,
              p.image_uri, p.page_label,
              CASE WHEN LOWER(p.source_text) LIKE LOWER(?) ESCAPE '\\' OR LOWER(p.raw_source_text) LIKE LOWER(?) ESCAPE '\\' THEN 1 ELSE 0 END AS source_match,
              p.updated_at AS sort_at
           FROM reader_passages p INNER JOIN reader_books b ON b.id = p.book_id AND b.owner_id = p.owner_id
           WHERE p.owner_id = ? AND p.deleted_at IS NULL AND b.deleted_at IS NULL AND (? IS NULL OR p.book_id = ?)
             AND (LOWER(p.title) LIKE LOWER(?) ESCAPE '\\' OR LOWER(p.page_label) LIKE LOWER(?) ESCAPE '\\'
                  OR LOWER(p.source_text) LIKE LOWER(?) ESCAPE '\\' OR LOWER(p.raw_source_text) LIKE LOWER(?) ESCAPE '\\'
                  OR LOWER(p.summary) LIKE LOWER(?) ESCAPE '\\')`,
        [pattern, pattern, this.workspaceId, bookId, bookId, pattern, pattern, pattern, pattern, pattern]);
    }
    if (kind === 'all' || kind === 'discussion') {
      add(`SELECT 'discussion' AS kind, d.id AS id, d.book_id, d.passage_id, d.id AS discussion_id,
              d.title, COALESCE(b.title, '独立问题') AS subtitle, d.last_message_preview AS preview,
              '' AS image_uri, COALESCE(p.page_label, '') AS page_label, 0 AS source_match, d.updated_at AS sort_at
           FROM reader_discussions d
           LEFT JOIN reader_books b ON b.id = d.book_id AND b.owner_id = d.owner_id
           LEFT JOIN reader_passages p ON p.id = d.passage_id AND p.owner_id = d.owner_id
           WHERE d.owner_id = ? AND d.deleted_at IS NULL AND (? IS NULL OR d.book_id = ?)
             AND (LOWER(d.title) LIKE LOWER(?) ESCAPE '\\' OR LOWER(d.last_message_preview) LIKE LOWER(?) ESCAPE '\\')`,
        [this.workspaceId, bookId, bookId, pattern, pattern]);
    }
    if (kind === 'all' || kind === 'message') {
      add(`SELECT 'message' AS kind, m.id AS id, d.book_id, d.passage_id, d.id AS discussion_id,
              d.title, COALESCE(b.title, '独立问题') AS subtitle, m.content AS preview,
              '' AS image_uri, COALESCE(p.page_label, '') AS page_label, 0 AS source_match, m.updated_at AS sort_at
           FROM reader_messages m INNER JOIN reader_discussions d ON d.id = m.discussion_id AND d.owner_id = m.owner_id
           LEFT JOIN reader_books b ON b.id = d.book_id AND b.owner_id = d.owner_id
           LEFT JOIN reader_passages p ON p.id = d.passage_id AND p.owner_id = d.owner_id
           WHERE m.owner_id = ? AND m.deleted_at IS NULL AND d.deleted_at IS NULL AND (? IS NULL OR d.book_id = ?)
             AND LOWER(m.content) LIKE LOWER(?) ESCAPE '\\'`,
        [this.workspaceId, bookId, bookId, pattern]);
    }
    const sql = `${clauses.join(' UNION ALL ')} ORDER BY sort_at DESC, id DESC LIMIT ? OFFSET ?`;
    const rows = await this.database.getAll<SearchRow>(sql, [...parameters, safeLimit, safeOffset]);
    return rows.map(mapSearchResult);
  }

  private async searchWithFts(
    value: string,
    kind: ReaderSearchResult['kind'] | 'all',
    bookId: string | null,
    limit: number,
    offset: number,
  ): Promise<readonly ReaderSearchResult[]> {
    const branches: string[] = [];
    const parameters: unknown[] = [];
    const match = readerSearchFtsMatch(value);
    const add = (type: ReaderSearchResult['kind'], sql: string, extra: readonly unknown[] = []) => {
      if (kind === 'all' || kind === type) {
        branches.push(sql);
        parameters.push(...extra, this.workspaceId, match);
      }
    };
    add('book', `SELECT 'book' AS kind, b.id AS id, b.id AS book_id, NULL AS passage_id, NULL AS discussion_id,
              b.title AS title, b.authors_json AS subtitle, COALESCE(NULLIF(b.summary, ''), NULLIF(b.note, ''), '') AS preview,
              b.cover_uri AS image_uri, '' AS page_label,
              b.title || char(10) || b.authors_json || char(10) || b.isbn || char(10) || b.summary || char(10) || b.note AS search_text,
              0 AS source_match, b.updated_at AS sort_at
           FROM reader_search_fts INNER JOIN reader_books b
             ON b.owner_id = reader_search_fts.owner_id AND b.id = reader_search_fts.entity_id
           WHERE reader_search_fts.owner_id = ? AND reader_search_fts.kind = 'book'
             AND reader_search_fts MATCH ? AND b.deleted_at IS NULL`);
    add('passage', `SELECT 'passage' AS kind, p.id AS id, p.book_id, p.id AS passage_id, NULL AS discussion_id,
              COALESCE(NULLIF(p.title, ''), p.page_label, '未命名摘录') AS title,
              b.title AS subtitle, COALESCE(NULLIF(p.summary, ''), '') AS preview,
              p.image_uri, p.page_label,
              p.title || char(10) || p.page_label || char(10) || p.summary || char(10) || p.source_text || char(10) || p.raw_source_text AS search_text,
              CASE WHEN instr(lower(reader_search_fts.source_text), lower(?)) > 0 THEN 1 ELSE 0 END AS source_match,
              p.updated_at AS sort_at
           FROM reader_search_fts INNER JOIN reader_passages p
             ON p.owner_id = reader_search_fts.owner_id AND p.id = reader_search_fts.entity_id
           INNER JOIN reader_books b ON b.id = p.book_id AND b.owner_id = p.owner_id
           WHERE reader_search_fts.owner_id = ? AND reader_search_fts.kind = 'passage'
             AND reader_search_fts MATCH ? AND p.deleted_at IS NULL AND b.deleted_at IS NULL`, [value]);
    add('discussion', `SELECT 'discussion' AS kind, d.id AS id, d.book_id, d.passage_id, d.id AS discussion_id,
              d.title, COALESCE(b.title, '独立问题') AS subtitle, d.last_message_preview AS preview,
              '' AS image_uri, COALESCE(p.page_label, '') AS page_label,
              d.title || char(10) || d.last_message_preview AS search_text,
              0 AS source_match, d.updated_at AS sort_at
           FROM reader_search_fts INNER JOIN reader_discussions d
             ON d.owner_id = reader_search_fts.owner_id AND d.id = reader_search_fts.entity_id
           LEFT JOIN reader_books b ON b.id = d.book_id AND b.owner_id = d.owner_id
           LEFT JOIN reader_passages p ON p.id = d.passage_id AND p.owner_id = d.owner_id
           WHERE reader_search_fts.owner_id = ? AND reader_search_fts.kind = 'discussion'
             AND reader_search_fts MATCH ? AND d.deleted_at IS NULL
             AND (d.book_id IS NULL OR (b.id IS NOT NULL AND b.deleted_at IS NULL))`);
    add('message', `SELECT 'message' AS kind, m.id AS id, d.book_id, d.passage_id, d.id AS discussion_id,
              d.title, COALESCE(b.title, '独立问题') AS subtitle, m.content AS preview,
              '' AS image_uri, COALESCE(p.page_label, '') AS page_label, m.content AS search_text,
              0 AS source_match, m.updated_at AS sort_at
           FROM reader_search_fts INNER JOIN reader_messages m
             ON m.owner_id = reader_search_fts.owner_id AND m.id = reader_search_fts.entity_id
           INNER JOIN reader_discussions d ON d.id = m.discussion_id AND d.owner_id = m.owner_id
           LEFT JOIN reader_books b ON b.id = d.book_id AND b.owner_id = d.owner_id
           LEFT JOIN reader_passages p ON p.id = d.passage_id AND p.owner_id = d.owner_id
           WHERE reader_search_fts.owner_id = ? AND reader_search_fts.kind = 'message'
             AND reader_search_fts MATCH ? AND m.deleted_at IS NULL AND d.deleted_at IS NULL
             AND (d.book_id IS NULL OR (b.id IS NOT NULL AND b.deleted_at IS NULL))`);
    const sql = `SELECT * FROM (${branches.join(' UNION ALL ')}) hits
      WHERE instr(lower(search_text), lower(?)) > 0 AND (? IS NULL OR book_id = ?)
      ORDER BY sort_at DESC, id DESC LIMIT ? OFFSET ?`;
    const rows = await this.database.getAll<SearchRow>(sql, [...parameters, value, bookId, bookId, limit, offset]);
    return rows.map(mapSearchResult);
  }

  watchPrompts(listener: (items: readonly ReaderPrompt[]) => void, onError: (error: Error) => void): ReaderUnsubscribe {
    return this.watch(
      `SELECT id, stage, system_template, user_template, include_book, include_source,
              include_summary, history_limit, created_at, updated_at FROM reader_prompts
       WHERE owner_id = ? ORDER BY CASE stage WHEN 'analysis' THEN 0 WHEN 'organize' THEN 1 WHEN 'discussion' THEN 2 ELSE 3 END`,
      [this.workspaceId], mapPrompt, listener, onError, 'Prompt 读取失败',
    );
  }

  watchRoles(listener: (items: readonly ReaderRole[]) => void, onError: (error: Error) => void): ReaderUnsubscribe {
    return this.watch(
      `SELECT id, name, description, prompt, position, created_at, updated_at, deleted_at
       FROM reader_roles WHERE owner_id = ? AND deleted_at IS NULL ORDER BY position ASC`,
      [this.workspaceId], mapRole, listener, onError, '阅读角色读取失败',
    );
  }

  watchPreferences(listener: (item: ReaderPreferences) => void, onError: (error: Error) => void): ReaderUnsubscribe {
    const controller = new AbortController();
    this.database.watch<SettingsRow>(
      `SELECT id, ocr_script, created_at, updated_at FROM reader_settings WHERE owner_id = ?`,
      [this.workspaceId],
      {
        onResult: (rows) => {
          const row = rows[0];
          if (row) listener(mapSettings(row));
        },
        onError: (error) => onError(safeDataError(error, 'Reader 设置读取失败')),
      },
      { signal: controller.signal, triggerImmediate: true },
    );
    return () => controller.abort();
  }

  async createBook(input: ReaderBookDraft): Promise<string> {
    const draft = normalizeReaderBook(input);
    const id = await createDatabaseId(this.database, 'reader-book');
    const now = this.timestamp();
    await this.database.execute(
      `INSERT INTO reader_books (
        id, owner_id, title, authors_json, cover_uri, isbn, publisher, published_at,
        summary, note, status, progress, page_count, pages_read, role_id, custom_prompt, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [id, this.workspaceId, draft.title, JSON.stringify(draft.authors), draft.coverUri, draft.isbn,
        draft.publisher, draft.publishedAt, draft.summary, draft.note, draft.status, draft.progress,
        draft.pageCount, draft.pagesRead, draft.roleId, draft.customPrompt, now, now],
    );
    return id;
  }

  async updateBook(id: string, input: ReaderBookDraft): Promise<void> {
    const draft = normalizeReaderBook(input);
    await this.database.execute(
      `UPDATE reader_books SET title = ?, authors_json = ?, cover_uri = ?, isbn = ?,
         publisher = ?, published_at = ?, summary = ?, note = ?, status = ?, progress = ?,
         page_count = ?, pages_read = ?, role_id = ?, custom_prompt = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
      [draft.title, JSON.stringify(draft.authors), draft.coverUri, draft.isbn, draft.publisher,
        draft.publishedAt, draft.summary, draft.note, draft.status, draft.progress, draft.pageCount, draft.pagesRead, draft.roleId,
        draft.customPrompt, this.timestamp(), id, this.workspaceId],
    );
  }

  async listBookPassageIds(id: string, context?: AtomicWriteContext): Promise<readonly string[]> {
    const rows = await (context ? sqlWriteContextOf(context) : this.database).getAll<{ id: string }>(
      'SELECT id FROM reader_passages WHERE book_id = ? AND owner_id = ? AND deleted_at IS NULL',
      [id, this.workspaceId],
    );
    return rows.map((row) => row.id);
  }

  async trashBook(id: string, write?: AtomicWriteContext): Promise<void> {
    const now = this.timestamp();
    const operation = async (transaction: SqlWriteContext) => {
      await transaction.execute('UPDATE reader_books SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', [now, now, id, this.workspaceId]);
      await transaction.execute(
        `UPDATE reader_passages SET deleted_at = ?, updated_at = ?,
         organization_status = CASE WHEN organization_status IN ('queued', 'running') THEN 'interrupted' ELSE organization_status END,
         organization_error = CASE WHEN organization_status IN ('queued', 'running') THEN '书籍已移入回收站，任务已停止' ELSE organization_error END,
         analysis_status = CASE WHEN analysis_status = 'running' THEN 'interrupted' ELSE analysis_status END,
         analysis_error = CASE WHEN analysis_status = 'running' THEN '书籍已移入回收站，任务已停止' ELSE analysis_error END
         WHERE book_id = ? AND owner_id = ? AND deleted_at IS NULL`,
        [now, now, id, this.workspaceId],
      );
      await transaction.execute('UPDATE reader_discussions SET deleted_at = ?, updated_at = ? WHERE book_id = ? AND owner_id = ? AND deleted_at IS NULL', [now, now, id, this.workspaceId]);
      await transaction.execute(`UPDATE reader_messages SET status = 'interrupted', error_message = '书籍已移入回收站，回答已停止', updated_at = ? WHERE owner_id = ? AND status = 'pending' AND deleted_at IS NULL AND discussion_id IN (SELECT id FROM reader_discussions WHERE book_id = ? AND owner_id = ? AND deleted_at = ?)`, [now, this.workspaceId, id, this.workspaceId, now]);
      await transaction.execute(`UPDATE reader_messages SET deleted_at = ?, updated_at = ? WHERE owner_id = ? AND deleted_at IS NULL AND discussion_id IN (SELECT id FROM reader_discussions WHERE book_id = ? AND owner_id = ? AND deleted_at = ?)`, [now, now, this.workspaceId, id, this.workspaceId, now]);
    };
    await (write ? operation(sqlWriteContextOf(write)) : this.database.writeTransaction(operation));
  }

  async restoreBook(id: string, write?: AtomicWriteContext): Promise<void> {
    const operation = async (transaction: SqlWriteContext) => {
      const row = await transaction.getOptional<{ deleted_at: string }>('SELECT deleted_at FROM reader_books WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL', [id, this.workspaceId]);
      if (!row) return;
      const now = this.timestamp();
      await transaction.execute('UPDATE reader_books SET deleted_at = NULL, updated_at = ? WHERE id = ? AND owner_id = ?', [now, id, this.workspaceId]);
      await transaction.execute('UPDATE reader_passages SET deleted_at = NULL, updated_at = ? WHERE book_id = ? AND owner_id = ? AND deleted_at = ?', [now, id, this.workspaceId, row.deleted_at]);
      await transaction.execute('UPDATE reader_discussions SET deleted_at = NULL, updated_at = ? WHERE book_id = ? AND owner_id = ? AND deleted_at = ?', [now, id, this.workspaceId, row.deleted_at]);
      await transaction.execute(`UPDATE reader_messages SET deleted_at = NULL, updated_at = ? WHERE owner_id = ? AND deleted_at = ? AND discussion_id IN (SELECT id FROM reader_discussions WHERE book_id = ? AND owner_id = ?)`, [now, this.workspaceId, row.deleted_at, id, this.workspaceId]);
      const restoredDiscussions = await transaction.getAll<{ id: string }>(
        'SELECT id FROM reader_discussions WHERE book_id = ? AND owner_id = ? AND deleted_at IS NULL',
        [id, this.workspaceId],
      );
      for (const discussion of restoredDiscussions) {
        await this.syncDiscussionProjection(transaction, discussion.id, now);
      }
    };
    await (write ? operation(sqlWriteContextOf(write)) : this.database.writeTransaction(operation));
  }

  async deleteBookPermanently(id: string): Promise<readonly string[]> {
    return this.database.writeTransaction(async (transaction) => {
      const book = await transaction.getOptional<{ cover_uri: string }>('SELECT cover_uri FROM reader_books WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL', [id, this.workspaceId]);
      if (!book) throw new Error('只能永久删除回收站中的书籍');
      const images = await transaction.getAll<{ image_uri: string }>('SELECT image_uri FROM reader_passages WHERE book_id = ? AND owner_id = ?', [id, this.workspaceId]);
      await transaction.execute('DELETE FROM reader_books WHERE id = ? AND owner_id = ?', [id, this.workspaceId]);
      return [book.cover_uri, ...images.map((row) => row.image_uri)].filter(Boolean);
    });
  }

  async createPassage(bookId: string, input: ReaderPassageDraft): Promise<string> {
    const draft = normalizeReaderPassage(input);
    return this.database.writeTransaction(async (transaction) => {
      await this.requireActiveBook(transaction, bookId);
      const id = await createDatabaseId(transaction, 'reader-passage');
      const now = this.timestamp();
      await transaction.execute(
        `INSERT INTO reader_passages (
          id, owner_id, book_id, title, page_label, image_uri, raw_source_text, source_text,
          source_revision, organized_source_revision,
          ocr_script, ocr_blocks_json, summary, suggested_questions_json,
          analysis_status, analysis_error, organization_status, organization_error,
          created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, '', '[]', 'idle', NULL, 'idle', NULL, ?, ?, NULL)`,
        [id, this.workspaceId, bookId, draft.title, draft.pageLabel, draft.imageUri,
          draft.rawSourceText ?? draft.sourceText, draft.sourceText, draft.ocrScript, JSON.stringify(draft.ocrBlocks), now, now],
      );
      await transaction.execute('UPDATE reader_books SET updated_at = ? WHERE id = ? AND owner_id = ?', [now, bookId, this.workspaceId]);
      return id;
    });
  }

  async getPassage(id: string): Promise<ReaderPassage | null> {
    const row = await this.database.getOptional<PassageRow>(
      `SELECT id, book_id, title, page_label, image_uri, raw_source_text, source_text,
              source_revision, organized_source_revision, ocr_script, ocr_blocks_json,
              summary, suggested_questions_json, analysis_status, analysis_error,
              organization_status, organization_error, created_at, updated_at, deleted_at
       FROM reader_passages WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
      [id, this.workspaceId],
    );
    return row ? mapPassage(row) : null;
  }

  /** Keeps a finished timer session; the book may have moved to the trash while it ran. */
  async recordReadingSession(bookId: string, draft: ReaderReadingSessionDraft): Promise<string> {
    const durationMs = readingDurationOf(draft);
    return this.database.writeTransaction(async (transaction) => {
      const book = await transaction.getOptional<{ id: string }>('SELECT id FROM reader_books WHERE id = ? AND owner_id = ?', [bookId, this.workspaceId]);
      if (!book) throw new Error('找不到这本书');
      const id = await createDatabaseId(transaction, 'reader-reading-session');
      await transaction.execute(
        `INSERT INTO reader_reading_sessions (id, owner_id, book_id, started_at, ended_at, duration_ms, start_page, end_page, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, this.workspaceId, bookId, draft.startedAt, draft.endedAt, durationMs, draft.startPage, draft.endPage, this.timestamp()],
      );
      return id;
    });
  }

  /** Corrects a kept session, e.g. a timer that was left running. */
  async updateReadingSession(id: string, draft: ReaderReadingSessionDraft): Promise<void> {
    const durationMs = readingDurationOf(draft);
    const result = await this.database.execute(
      `UPDATE reader_reading_sessions SET started_at = ?, ended_at = ?, duration_ms = ?, start_page = ?, end_page = ?
       WHERE id = ? AND owner_id = ?`,
      [draft.startedAt, draft.endedAt, durationMs, draft.startPage, draft.endPage, id, this.workspaceId],
    );
    if (!result.rowsAffected) throw new Error('找不到这条阅读记录');
  }

  async deleteReadingSession(id: string): Promise<void> {
    await this.database.execute('DELETE FROM reader_reading_sessions WHERE id = ? AND owner_id = ?', [id, this.workspaceId]);
  }

  watchReadingSummary(bookId: string, listener: (summary: ReaderReadingSummary) => void, onError: (error: Error) => void): ReaderUnsubscribe {
    return this.watch<ReadingSummaryRow, ReaderReadingSummary>(
      `SELECT COUNT(*) AS session_count, COALESCE(SUM(duration_ms), 0) AS total_ms, MAX(ended_at) AS last_read_at
       FROM reader_reading_sessions WHERE owner_id = ? AND book_id = ?`,
      [this.workspaceId, bookId], (row) => mapReadingSummary(row), (items) => listener(items[0] ?? mapReadingSummary(undefined)), onError, '阅读记录读取失败',
    );
  }

  watchReadingSessions(bookId: string, listener: (items: readonly ReaderReadingSession[]) => void, onError: (error: Error) => void): ReaderUnsubscribe {
    return this.watch(
      `SELECT id, book_id, started_at, ended_at, duration_ms, start_page, end_page, created_at
       FROM reader_reading_sessions WHERE owner_id = ? AND book_id = ?
       ORDER BY started_at DESC, id DESC`,
      [this.workspaceId, bookId], mapReadingSession, listener, onError, '阅读记录读取失败',
    );
  }

  async updatePassage(id: string, input: ReaderPassageDraft, expectedSourceRevision?: number): Promise<void> {
    const draft = normalizeReaderPassage(input);
    const current = await this.getPassage(id);
    if (!current) throw new Error('找不到要更新的摘录');
    if (expectedSourceRevision !== undefined && current.sourceRevision !== expectedSourceRevision) {
      throw new Error('摘录已被其他操作修改，请重新载入后再保存');
    }
    const rawSourceText = input.rawSourceText === undefined
      ? current.rawSourceText
      : draft.rawSourceText;
    const contentChanged = current.rawSourceText !== rawSourceText
      || current.sourceText !== draft.sourceText;
    const result = await this.database.execute(
      `UPDATE reader_passages SET title = ?, page_label = ?, image_uri = ?, raw_source_text = ?,
         source_text = ?, source_revision = source_revision + ?,
         organization_status = CASE WHEN ? = 1 THEN 'idle' ELSE organization_status END,
         organization_error = CASE WHEN ? = 1 THEN NULL ELSE organization_error END,
         analysis_status = CASE WHEN ? = 1 THEN 'idle' ELSE analysis_status END,
         analysis_error = CASE WHEN ? = 1 THEN NULL ELSE analysis_error END,
         summary = CASE WHEN ? = 1 THEN '' ELSE summary END,
         suggested_questions_json = CASE WHEN ? = 1 THEN '[]' ELSE suggested_questions_json END,
         ocr_script = ?, ocr_blocks_json = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? AND deleted_at IS NULL` +
       (expectedSourceRevision !== undefined ? ' AND source_revision = ?' : ''),
      [
        draft.title, draft.pageLabel, draft.imageUri, rawSourceText, draft.sourceText,
        contentChanged ? 1 : 0, contentChanged ? 1 : 0, contentChanged ? 1 : 0,
        contentChanged ? 1 : 0, contentChanged ? 1 : 0, contentChanged ? 1 : 0,
        contentChanged ? 1 : 0, draft.ocrScript, JSON.stringify(draft.ocrBlocks), this.timestamp(), id, this.workspaceId,
        ...(expectedSourceRevision !== undefined ? [expectedSourceRevision] : []),
      ],
    );
    if (expectedSourceRevision !== undefined && result.rowsAffected !== 1) {
      throw new Error('摘录已被其他操作修改，请重新载入后再保存');
    }
    if (contentChanged && result.rowsAffected === 1) {
      await this.database.execute(
        'DELETE FROM reader_passage_organization_candidates WHERE passage_id = ? AND owner_id = ?',
        [id, this.workspaceId],
      );
    }
  }

  async admitPassageWork(
    id: string,
    expectedRevision: number,
    operation: 'organize' | 'analysis',
    write?: AtomicWriteContext,
  ): Promise<boolean> {
    const database = write ? sqlWriteContextOf(write) : this.database;
    const result = operation === 'organize'
      ? await database.execute(
        `UPDATE reader_passages SET organization_status = 'queued', organization_error = NULL, updated_at = ?
         WHERE id = ? AND owner_id = ? AND source_revision = ? AND deleted_at IS NULL
         AND organization_status NOT IN ('queued', 'running') AND analysis_status != 'running'`,
        [this.timestamp(), id, this.workspaceId, expectedRevision],
      )
      : await database.execute(
        `UPDATE reader_passages SET analysis_status = 'running', analysis_error = NULL, updated_at = ?
         WHERE id = ? AND owner_id = ? AND source_revision = ? AND deleted_at IS NULL
         AND organization_status NOT IN ('queued', 'running') AND analysis_status != 'running'`,
        [this.timestamp(), id, this.workspaceId, expectedRevision],
      );
    return result.rowsAffected === 1;
  }

  async setPassageOrganizationRunning(id: string, expectedRevision: number): Promise<boolean> {
    const result = await this.database.execute("UPDATE reader_passages SET organization_status = 'running', organization_error = NULL, updated_at = ? WHERE id = ? AND owner_id = ? AND source_revision = ? AND deleted_at IS NULL", [this.timestamp(), id, this.workspaceId, expectedRevision]);
    return result.rowsAffected === 1;
  }

  async setPassageOrganizationRetrying(id: string, expectedRevision: number, message: string): Promise<void> {
    await this.database.execute(
      `UPDATE reader_passages SET organization_error = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? AND source_revision = ? AND deleted_at IS NULL
         AND organization_status IN ('queued', 'running')`,
      [message.slice(0, 2_000), this.timestamp(), id, this.workspaceId, expectedRevision],
    );
  }

  async savePassageOrganization(id: string, expectedRevision: number, sourceText: string, queueAnalysis = false): Promise<boolean> {
    const result = await this.database.execute(
      `UPDATE reader_passages SET source_text = ?, source_revision = source_revision + 1,
         organized_source_revision = source_revision + 1, organization_status = 'completed',
         organization_error = NULL, summary = '', suggested_questions_json = '[]',
         analysis_status = ?, analysis_error = NULL, updated_at = ?
       WHERE id = ? AND owner_id = ? AND source_revision = ? AND deleted_at IS NULL`,
      [normalizeOrganizedText(sourceText), queueAnalysis ? 'running' : 'idle', this.timestamp(), id, this.workspaceId, expectedRevision],
    );
    if (result.rowsAffected === 1) {
      await this.database.execute(
        'DELETE FROM reader_passage_organization_candidates WHERE passage_id = ? AND owner_id = ?',
        [id, this.workspaceId],
      );
    }
    return result.rowsAffected === 1;
  }

  async savePassageOrganizationCandidate(id: string, expectedRevision: number, sourceText: string): Promise<boolean> {
    const normalized = normalizeOrganizedText(sourceText);
    return this.database.writeTransaction(async (transaction) => {
      const passage = await transaction.getOptional<{ id: string }>(
        `SELECT id FROM reader_passages
         WHERE id = ? AND owner_id = ? AND source_revision = ? AND deleted_at IS NULL`,
        [id, this.workspaceId, expectedRevision],
      );
      if (!passage) return false;
      const now = this.timestamp();
      const candidateId = await createDatabaseId(transaction, 'reader-org-candidate');
      await transaction.execute(
        `INSERT INTO reader_passage_organization_candidates (
          id, owner_id, passage_id, source_revision, source_text, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, passage_id, source_revision) DO UPDATE SET
          id = excluded.id, source_text = excluded.source_text, updated_at = excluded.updated_at`,
        [candidateId, this.workspaceId, id, expectedRevision, normalized, now, now],
      );
      await transaction.execute(
        `UPDATE reader_passages SET organization_status = 'candidate', organization_error = NULL, updated_at = ?
         WHERE id = ? AND owner_id = ? AND source_revision = ? AND deleted_at IS NULL`,
        [now, id, this.workspaceId, expectedRevision],
      );
      return true;
    });
  }

  async applyPassageOrganizationCandidate(id: string, candidateId: string, expectedRevision: number): Promise<boolean> {
    return this.database.writeTransaction(async (transaction) => {
      const candidate = await transaction.getOptional<{ source_text: string }>(
        `SELECT source_text FROM reader_passage_organization_candidates
         WHERE id = ? AND passage_id = ? AND owner_id = ? AND source_revision = ?`,
        [candidateId, id, this.workspaceId, expectedRevision],
      );
      if (!candidate) return false;
      const now = this.timestamp();
      const result = await transaction.execute(
        `UPDATE reader_passages SET source_text = ?, source_revision = source_revision + 1,
           organized_source_revision = source_revision + 1, organization_status = 'completed',
           organization_error = NULL, summary = '', suggested_questions_json = '[]',
           analysis_status = 'idle', analysis_error = NULL, updated_at = ?
         WHERE id = ? AND owner_id = ? AND source_revision = ? AND deleted_at IS NULL`,
        [candidate.source_text, now, id, this.workspaceId, expectedRevision],
      );
      if (result.rowsAffected !== 1) return false;
      await transaction.execute(
        'DELETE FROM reader_passage_organization_candidates WHERE id = ? AND owner_id = ?',
        [candidateId, this.workspaceId],
      );
      return true;
    });
  }

  async discardPassageOrganizationCandidate(id: string, candidateId: string): Promise<boolean> {
    const result = await this.database.execute(
      'DELETE FROM reader_passage_organization_candidates WHERE id = ? AND passage_id = ? AND owner_id = ?',
      [candidateId, id, this.workspaceId],
    );
    return result.rowsAffected === 1;
  }

  async setPassageOrganizationFailure(id: string, expectedRevision: number, message: string, interrupted = false): Promise<void> {
    await this.database.execute(
      `UPDATE reader_passages SET organization_status = ?, organization_error = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? AND source_revision = ? AND deleted_at IS NULL`,
      [interrupted ? 'interrupted' : 'failed', message.slice(0, 2_000), this.timestamp(), id, this.workspaceId, expectedRevision],
    );
  }

  async setPassageAnalysisRunning(id: string, expectedRevision: number, write?: AtomicWriteContext): Promise<boolean> {
    const result = await (write ? sqlWriteContextOf(write) : this.database).execute(
      `UPDATE reader_passages SET analysis_status = 'running', analysis_error = NULL, updated_at = ?
       WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND source_revision = ?`,
      [this.timestamp(), id, this.workspaceId, expectedRevision],
    );
    return result.rowsAffected === 1;
  }

  async savePassageAnalysis(id: string, summary: string, questions: readonly string[], expectedRevision: number): Promise<boolean> {
    const normalizedSummary = normalizeReaderAnalysisSummary(summary);
    const result = await this.database.execute(
      `UPDATE reader_passages SET summary = ?, suggested_questions_json = ?,
         analysis_status = 'completed', analysis_error = NULL, updated_at = ?
       WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND source_revision = ?`,
      [normalizedSummary, JSON.stringify(questions.map((item) => item.trim()).filter(Boolean).slice(0, 12)), this.timestamp(), id, this.workspaceId, expectedRevision],
    );
    return result.rowsAffected === 1;
  }

  async setPassageAnalysisFailureIfCurrent(id: string, expectedRevision: number, message: string, interrupted = false): Promise<void> {
    await this.database.execute(
      `UPDATE reader_passages SET analysis_status = ?, analysis_error = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? AND source_revision = ? AND deleted_at IS NULL`,
      [interrupted ? 'interrupted' : 'failed', message.slice(0, 2_000), this.timestamp(), id, this.workspaceId, expectedRevision],
    );
  }

  async interruptPassageWork(
    id: string,
    organizationMessage: string,
    analysisMessage: string,
    write?: AtomicWriteContext,
  ): Promise<void> {
    await (write ? sqlWriteContextOf(write) : this.database).execute(
      `UPDATE reader_passages SET
       organization_status = CASE WHEN organization_status IN ('queued', 'running') THEN 'interrupted' ELSE organization_status END,
       organization_error = CASE WHEN organization_status IN ('queued', 'running') THEN ? ELSE organization_error END,
       analysis_status = CASE WHEN analysis_status = 'running' THEN 'interrupted' ELSE analysis_status END,
       analysis_error = CASE WHEN analysis_status = 'running' THEN ? ELSE analysis_error END,
       updated_at = ?
       WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
      [organizationMessage.slice(0, 2_000), analysisMessage.slice(0, 2_000), this.timestamp(), id, this.workspaceId],
    );
  }

  async trashPassage(id: string, write?: AtomicWriteContext): Promise<void> {
    const now = this.timestamp();
    await (write ? sqlWriteContextOf(write) : this.database).execute(
      `UPDATE reader_passages SET deleted_at = ?, updated_at = ?,
       organization_status = CASE WHEN organization_status IN ('queued', 'running') THEN 'interrupted' ELSE organization_status END,
       organization_error = CASE WHEN organization_status IN ('queued', 'running') THEN '摘录已移入回收站，任务已停止' ELSE organization_error END,
       analysis_status = CASE WHEN analysis_status = 'running' THEN 'interrupted' ELSE analysis_status END,
       analysis_error = CASE WHEN analysis_status = 'running' THEN '摘录已移入回收站，任务已停止' ELSE analysis_error END
       WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
      [now, now, id, this.workspaceId],
    );
  }

  async restorePassage(id: string, write?: AtomicWriteContext): Promise<void> {
    await (write ? sqlWriteContextOf(write) : this.database).execute('UPDATE reader_passages SET deleted_at = NULL, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL', [this.timestamp(), id, this.workspaceId]);
  }

  async deletePassagePermanently(id: string): Promise<string | null> {
    return this.database.writeTransaction(async (transaction) => {
      const row = await transaction.getOptional<{ image_uri: string }>('SELECT image_uri FROM reader_passages WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL', [id, this.workspaceId]);
      if (!row) throw new Error('只能永久删除回收站中的摘录');
      await transaction.execute('DELETE FROM reader_message_sources WHERE passage_id = ? AND owner_id = ?', [id, this.workspaceId]);
      await transaction.execute('DELETE FROM reader_discussion_sources WHERE passage_id = ? AND owner_id = ?', [id, this.workspaceId]);
      await transaction.execute('DELETE FROM reader_passage_organization_candidates WHERE passage_id = ? AND owner_id = ?', [id, this.workspaceId]);
      await transaction.execute('DELETE FROM reader_passages WHERE id = ? AND owner_id = ?', [id, this.workspaceId]);
      return row.image_uri || null;
    });
  }

  async createFolder(value: string): Promise<string> {
    const name = normalizeReaderFolderName(value);
    return this.database.writeTransaction(async (transaction) => {
      const position = await transaction.get<{ value: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS value FROM reader_folders WHERE owner_id = ?', [this.workspaceId]);
      const id = await createDatabaseId(transaction, 'reader-folder');
      const now = this.timestamp();
      await transaction.execute('INSERT INTO reader_folders (id, owner_id, name, position, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)', [id, this.workspaceId, name, Number(position.value), now, now]);
      return id;
    });
  }

  async renameFolder(id: string, value: string): Promise<void> {
    await this.database.execute('UPDATE reader_folders SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', [normalizeReaderFolderName(value), this.timestamp(), id, this.workspaceId]);
  }

  async deleteFolder(id: string): Promise<void> {
    const now = this.timestamp();
    await this.database.writeTransaction(async (transaction) => {
      await transaction.execute('UPDATE reader_folders SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', [now, now, id, this.workspaceId]);
      await transaction.execute('UPDATE reader_discussions SET folder_id = NULL, updated_at = ? WHERE folder_id = ? AND owner_id = ?', [now, id, this.workspaceId]);
    });
  }

  async createDiscussion(input: ReaderDiscussionDraft): Promise<string> {
    const draft = normalizeReaderDiscussion(input);
    return this.database.writeTransaction(async (transaction) => {
      const sourceIds = draft.passageIds?.length
        ? draft.passageIds
        : draft.passageId ? [draft.passageId] : [];
      const sourceRows: { id: string; book_id: string; source_revision: number; deleted_at: string | null }[] = [];
      for (const passageId of sourceIds) {
        const row = await transaction.getOptional<{ id: string; book_id: string; source_revision: number; deleted_at: string | null }>(
          'SELECT id, book_id, source_revision, deleted_at FROM reader_passages WHERE id = ? AND owner_id = ?',
          [passageId, this.workspaceId],
        );
        if (!row || row.deleted_at !== null) throw new Error('关联的摘录不存在或已在回收站');
        if (draft.bookId !== row.book_id) throw new Error('关联书籍与摘录所属书籍不一致');
        sourceRows.push(row);
      }
      assertReaderDiscussionContext(draft, new Map(sourceRows.map((row) => [row.id, {
        id: row.id,
        bookId: row.book_id,
        deletedAt: row.deleted_at,
      }])));
      const id = await createDatabaseId(transaction, 'reader-discussion');
      const messageId = await createDatabaseId(transaction, 'reader-message');
      const now = this.timestamp();
      await transaction.execute(
        `INSERT INTO reader_discussions (
          id, owner_id, title, book_id, passage_id, folder_id, unread,
          last_message_at, last_message_preview, last_message_status, latest_assistant_message_id,
          created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'completed', NULL, ?, ?, NULL)`,
        [id, this.workspaceId, draft.title, draft.bookId, sourceIds[0] ?? null, draft.folderId, now, draft.openingMessage.slice(0, 320), now, now],
      );
      for (const [position, row] of sourceRows.entries()) {
        await transaction.execute(
          `INSERT INTO reader_discussion_sources (
            id, owner_id, discussion_id, passage_id, source_revision, position, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [await createDatabaseId(transaction, 'reader-discussion-source'), this.workspaceId, id, row.id,
            row.source_revision, position, now],
        );
      }
      await transaction.execute(
        `INSERT INTO reader_messages (
          id, owner_id, discussion_id, role, content, status, favorite, collapsed,
          error_message, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, 'user', ?, 'completed', 0, 0, NULL, ?, ?, NULL)`,
        [messageId, this.workspaceId, id, draft.openingMessage, now, now],
      );
      for (const [position, row] of sourceRows.entries()) {
        await transaction.execute(
          `INSERT INTO reader_message_sources (
            id, owner_id, message_id, passage_id, source_revision, position, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [await createDatabaseId(transaction, 'reader-message-source'), this.workspaceId, messageId, row.id,
            row.source_revision, position, now],
        );
      }
      return id;
    });
  }

  async updateDiscussionFolder(id: string, folderId: string | null): Promise<void> {
    await this.database.execute('UPDATE reader_discussions SET folder_id = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', [folderId, this.timestamp(), id, this.workspaceId]);
  }

  async markDiscussionRead(id: string): Promise<void> {
    await this.database.execute('UPDATE reader_discussions SET unread = 0, updated_at = ? WHERE id = ? AND owner_id = ?', [this.timestamp(), id, this.workspaceId]);
  }

  async trashDiscussion(id: string, write?: AtomicWriteContext): Promise<void> {
    const now = this.timestamp();
    const operation = async (transaction: SqlWriteContext) => {
      await transaction.execute('UPDATE reader_discussions SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', [now, now, id, this.workspaceId]);
      await transaction.execute("UPDATE reader_messages SET status = 'interrupted', error_message = '讨论已移入回收站，回答已停止', updated_at = ? WHERE discussion_id = ? AND owner_id = ? AND status = 'pending' AND deleted_at IS NULL", [now, id, this.workspaceId]);
      await transaction.execute('UPDATE reader_messages SET deleted_at = ?, updated_at = ? WHERE discussion_id = ? AND owner_id = ? AND deleted_at IS NULL', [now, now, id, this.workspaceId]);
    };
    await (write ? operation(sqlWriteContextOf(write)) : this.database.writeTransaction(operation));
  }

  async restoreDiscussion(id: string, write?: AtomicWriteContext): Promise<void> {
    const operation = async (transaction: SqlWriteContext) => {
      const row = await transaction.getOptional<{ deleted_at: string }>('SELECT deleted_at FROM reader_discussions WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL', [id, this.workspaceId]);
      if (!row) return;
      const now = this.timestamp();
      await transaction.execute('UPDATE reader_discussions SET deleted_at = NULL, updated_at = ? WHERE id = ? AND owner_id = ?', [now, id, this.workspaceId]);
      await transaction.execute('UPDATE reader_messages SET deleted_at = NULL, updated_at = ? WHERE discussion_id = ? AND owner_id = ? AND deleted_at = ?', [now, id, this.workspaceId, row.deleted_at]);
      await this.syncDiscussionProjection(transaction, id, now);
    };
    await (write ? operation(sqlWriteContextOf(write)) : this.database.writeTransaction(operation));
  }

  async deleteDiscussionPermanently(id: string): Promise<void> {
    await this.database.execute('DELETE FROM reader_discussions WHERE id = ? AND owner_id = ? AND deleted_at IS NOT NULL', [id, this.workspaceId]);
  }

  async appendMessage(discussionId: string, role: 'user' | 'assistant', content: string, status: ReaderMessageStatus): Promise<string> {
    const normalized = content.replace(/\r\n/g, '\n').trim().slice(0, 500_000);
    if (!normalized && role === 'user') throw new Error('消息不能为空');
    return this.database.writeTransaction(async (transaction) => {
      const id = await createDatabaseId(transaction, 'reader-message');
      const now = this.timestamp();
      await transaction.execute(
        `INSERT INTO reader_messages (
          id, owner_id, discussion_id, role, content, status, favorite, collapsed,
          error_message, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?, NULL)`,
        [id, this.workspaceId, discussionId, role, normalized, status, now, now],
      );
      await this.syncDiscussionProjection(transaction, discussionId, now, { resetUnread: true });
      return id;
    });
  }

  async recordMessageSources(
    messageId: string,
    sources: readonly Pick<ReaderMessageSource, 'passageId' | 'sourceRevision'>[],
  ): Promise<void> {
    await this.database.writeTransaction(async (transaction) => {
      const message = await transaction.getOptional<{ id: string }>(
        'SELECT id FROM reader_messages WHERE id = ? AND owner_id = ? AND deleted_at IS NULL',
        [messageId, this.workspaceId],
      );
      if (!message) throw new Error('消息不存在，无法记录来源');
      await transaction.execute('DELETE FROM reader_message_sources WHERE message_id = ? AND owner_id = ?', [messageId, this.workspaceId]);
      const seen = new Set<string>();
      const now = this.timestamp();
      for (const [position, source] of sources.entries()) {
        if (seen.has(source.passageId) || position >= 5) continue;
        seen.add(source.passageId);
        await transaction.execute(
          `INSERT INTO reader_message_sources (
            id, owner_id, message_id, passage_id, source_revision, position, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [await createDatabaseId(transaction, 'reader-message-source'), this.workspaceId, messageId,
            source.passageId, source.sourceRevision, position, now],
        );
      }
    });
  }

  async completeMessage(id: string, content: string): Promise<void> {
    const now = this.timestamp();
    await this.database.writeTransaction(async (transaction) => {
      const message = await transaction.getOptional<{ discussion_id: string }>(
        `SELECT discussion_id FROM reader_messages WHERE id = ? AND owner_id = ?
         AND role = 'assistant' AND deleted_at IS NULL`,
        [id, this.workspaceId],
      );
      if (!message) throw new Error('讨论回答不存在');
      const trimmed = content.trim().slice(0, 500_000);
      const result = await transaction.execute(
        `UPDATE reader_messages SET content = ?, status = 'completed', error_message = NULL, updated_at = ?
         WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
        [trimmed, now, id, this.workspaceId],
      );
      if (result.rowsAffected !== 1) return;
      await this.syncDiscussionProjection(transaction, message.discussion_id, now, { markUnreadForAssistantId: id });
    });
  }

  async prepareMessageRetry(id: string): Promise<void> {
    const now = this.timestamp();
    await this.database.writeTransaction(async (transaction) => {
      const message = await transaction.getOptional<{ discussion_id: string }>(
        `SELECT discussion_id FROM reader_messages WHERE id = ? AND owner_id = ?
         AND role = 'assistant' AND status IN ('failed', 'interrupted') AND deleted_at IS NULL`,
        [id, this.workspaceId],
      );
      if (!message) throw new Error('这条回答不能重试');
      const result = await transaction.execute(
        `UPDATE reader_messages SET content = '', status = 'pending', error_message = NULL, updated_at = ?
         WHERE id = ? AND owner_id = ? AND role = 'assistant'
           AND status IN ('failed', 'interrupted') AND deleted_at IS NULL`,
        [now, id, this.workspaceId],
      );
      if (result.rowsAffected !== 1) throw new Error('这条回答不能重试');
      await this.syncDiscussionProjection(transaction, message.discussion_id, now);
    });
  }

  async failMessage(id: string, message: string): Promise<void> {
    const now = this.timestamp();
    await this.database.writeTransaction(async (transaction) => {
      const msg = await transaction.getOptional<{ discussion_id: string }>(
        `SELECT discussion_id FROM reader_messages WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
        [id, this.workspaceId],
      );
      await transaction.execute(
        `UPDATE reader_messages SET status = 'failed', error_message = ?, updated_at = ?
         WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
        [message.slice(0, 2_000), now, id, this.workspaceId],
      );
      if (msg) await this.syncDiscussionProjection(transaction, msg.discussion_id, now);
    });
  }

  async setMessageFavorite(id: string, favorite: boolean): Promise<void> {
    await this.database.execute('UPDATE reader_messages SET favorite = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND role = ?', [favorite ? 1 : 0, this.timestamp(), id, this.workspaceId, 'assistant']);
  }

  async setMessageCollapsed(id: string, collapsed: boolean): Promise<void> {
    await this.database.execute('UPDATE reader_messages SET collapsed = ?, updated_at = ? WHERE id = ? AND owner_id = ?', [collapsed ? 1 : 0, this.timestamp(), id, this.workspaceId]);
  }

  async deleteMessagePair(questionId: string, answerId: string | null): Promise<void> {
    const now = this.timestamp();
    await this.database.writeTransaction(async (transaction) => {
      const target = await transaction.getOptional<{ discussion_id: string }>(
        'SELECT discussion_id FROM reader_messages WHERE id = ? AND owner_id = ? AND deleted_at IS NULL',
        [questionId, this.workspaceId],
      );
      await transaction.execute('UPDATE reader_messages SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', [now, now, questionId, this.workspaceId]);
      if (answerId) await transaction.execute('UPDATE reader_messages SET deleted_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', [now, now, answerId, this.workspaceId]);
      if (target) {
        await this.syncDiscussionProjection(transaction, target.discussion_id, now);
      }
    });
  }

  private async syncDiscussionProjection(
    transaction: SqlWriteContext,
    discussionId: string,
    now: string,
    options: { resetUnread?: boolean; markUnreadForAssistantId?: string } = {},
  ): Promise<void> {
    const latestMessage = (column: 'content' | 'status' | 'created_at') => `(
      SELECT m.${column} FROM reader_messages m
      WHERE m.discussion_id = reader_discussions.id
        AND m.owner_id = reader_discussions.owner_id AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC, m.id DESC LIMIT 1
    )`;
    const latestAssistantId = `(
      SELECT m.id FROM reader_messages m
      WHERE m.discussion_id = reader_discussions.id
        AND m.owner_id = reader_discussions.owner_id
        AND m.role = 'assistant' AND m.status = 'completed' AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC, m.id DESC LIMIT 1
    )`;
    const unreadAssistantId = options.markUnreadForAssistantId ?? null;
    await transaction.execute(
      `UPDATE reader_discussions SET
         last_message_at = COALESCE(${latestMessage('created_at')}, created_at),
         last_message_preview = COALESCE(substr(${latestMessage('content')}, 1, 320), ''),
         last_message_status = ${latestMessage('status')},
         latest_assistant_message_id = ${latestAssistantId},
         unread = CASE
           WHEN ? = 1 THEN 0
           WHEN ? IS NOT NULL AND ? = ${latestAssistantId} THEN 1
           WHEN ${latestAssistantId} IS NULL THEN 0
           ELSE unread
         END,
         updated_at = ?
       WHERE owner_id = ? AND id = ? AND deleted_at IS NULL`,
      [
        options.resetUnread ? 1 : 0,
        unreadAssistantId,
        unreadAssistantId,
        now,
        this.workspaceId,
        discussionId,
      ],
    );
  }

  async savePrompt(stage: ReaderPromptStage, input: ReaderPromptDraft): Promise<void> {
    const draft = normalizeReaderPrompt(input);
    await this.database.execute(
      `UPDATE reader_prompts SET system_template = ?, user_template = ?, include_book = ?,
         include_source = ?, include_summary = ?, history_limit = ?, updated_at = ?
       WHERE owner_id = ? AND stage = ?`,
      [draft.systemTemplate, draft.userTemplate, draft.includeBook ? 1 : 0, draft.includeSource ? 1 : 0,
        draft.includeSummary ? 1 : 0, draft.historyLimit, this.timestamp(), this.workspaceId, stage],
    );
  }

  async resetPrompt(stage: ReaderPromptStage): Promise<void> {
    await this.savePrompt(stage, defaultPromptDraft(stage));
  }

  async saveRole(id: string, input: ReaderRoleDraft): Promise<void> {
    const draft = normalizeReaderRole(input);
    await this.database.execute('UPDATE reader_roles SET name = ?, description = ?, prompt = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', [draft.name, draft.description, draft.prompt, this.timestamp(), id, this.workspaceId]);
  }

  async resetRole(id: string): Promise<void> {
    await this.saveRole(id, defaultRoleDraft(id));
  }

  async savePreferences(input: ReaderPreferences): Promise<void> {
    const value = normalizeReaderPreferences(input);
    await this.database.execute(
      'UPDATE reader_settings SET ocr_script = ?, updated_at = ? WHERE owner_id = ?',
      [value.ocrScript, this.timestamp(), this.workspaceId],
    );
  }

  private watch<Row, Entity>(
    sql: string,
    parameters: readonly unknown[],
    map: (row: Row) => Entity,
    listener: (items: readonly Entity[]) => void,
    onError: (error: Error) => void,
    fallback: string,
  ): ReaderUnsubscribe {
    const controller = new AbortController();
    this.database.watch<Row>(
      sql,
      parameters,
      {
        onResult: (rows) => listener(rows.map(map)),
        onError: (error) => onError(safeDataError(error, fallback)),
      },
      { signal: controller.signal, triggerImmediate: true },
    );
    return () => controller.abort();
  }

  private async requireActiveBook(transaction: SqlWriteContext, id: string): Promise<void> {
    const book = await transaction.getOptional<{ id: string }>('SELECT id FROM reader_books WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', [id, this.workspaceId]);
    if (!book) throw new Error('找不到这本书');
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
