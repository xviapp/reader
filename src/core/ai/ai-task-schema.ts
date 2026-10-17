export const AI_TASK_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS ai_tasks (
    id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL,
    subject_id TEXT NOT NULL, operation TEXT NOT NULL, idempotency_key TEXT NOT NULL,
    service_id TEXT NOT NULL,
    payload_json TEXT NOT NULL, status TEXT NOT NULL, attempt_count INTEGER NOT NULL,
    not_before_at TEXT, error_code TEXT, error_message TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
    UNIQUE(owner_id, idempotency_key)
  )`,
  'CREATE INDEX IF NOT EXISTS ai_tasks_owner_status_due ON ai_tasks(owner_id, deleted_at, status, not_before_at, created_at)',
  'CREATE INDEX IF NOT EXISTS ai_tasks_owner_subject ON ai_tasks(owner_id, subject_id, deleted_at, status, created_at)',
] as const;
