import { AI_TASK_SCHEMA_STATEMENTS } from '@/core/ai/ai-task-schema';
import { READER_SCHEMA_STATEMENTS } from '@/modules/reader/data/schema';

export const READER_DATABASE_SCHEMA = [
  ...AI_TASK_SCHEMA_STATEMENTS,
  ...READER_SCHEMA_STATEMENTS,
] as const;

// Reader 1.0.20 created ai_tasks with a required legacy `module` column.
// The current Reader schema intentionally removes that dimension. Rebuild the
// small task table at initialization so existing installs can adopt the new
// schema without losing queued or completed task history.
export const READER_DATABASE_MIGRATION_STATEMENTS = [
  'DROP INDEX IF EXISTS ai_tasks_owner_status_due',
  'DROP INDEX IF EXISTS ai_tasks_owner_subject',
  'ALTER TABLE ai_tasks RENAME TO ai_tasks_legacy',
  AI_TASK_SCHEMA_STATEMENTS[0],
  `INSERT OR IGNORE INTO ai_tasks (
     id, owner_id, subject_id, operation, idempotency_key, service_id,
     payload_json, status, attempt_count, not_before_at, error_code,
     error_message, created_at, updated_at, deleted_at
   )
   SELECT id, owner_id, subject_id, operation, idempotency_key, service_id,
     payload_json, status, attempt_count, not_before_at, error_code,
     error_message, created_at, updated_at, deleted_at
   FROM ai_tasks_legacy`,
  'DROP TABLE ai_tasks_legacy',
  AI_TASK_SCHEMA_STATEMENTS[1],
  AI_TASK_SCHEMA_STATEMENTS[2],
  // Books gained a page count and pages read; progress is derived from them. Re-running is
  // harmless: duplicate columns are skipped by the migration runner.
  'ALTER TABLE reader_books ADD COLUMN page_count INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE reader_books ADD COLUMN pages_read INTEGER NOT NULL DEFAULT 0',
] as const;
