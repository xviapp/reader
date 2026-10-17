import type { LocalDatabase, SqlWriteContext } from '@/core/data/database-contract';
import type { AtomicWriteContext } from '@/core/data/atomic-write';
import { createAtomicWriteContext, sqlWriteContextOf } from '@/core/data/atomic-write.internal';
import { createDatabaseId, safeDataError } from '@/core/data/repository-utils';

import { AiEngineError } from './ai-engine';

type AiTaskStatus = 'queued' | 'running' | 'interrupted' | 'succeeded' | 'failed' | 'cancelled';

export interface AiTask<Payload = unknown> {
  id: string;
  subjectId: string;
  operation: string;
  idempotencyKey: string;
  serviceId: string;
  payload: Payload;
  status: AiTaskStatus;
  attemptCount: number;
  notBeforeAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AiTaskExecutionContext {
  signal: AbortSignal;
}

export type AiTaskHandler = (task: AiTask, context: AiTaskExecutionContext) => Promise<void>;

export interface AiTaskInput {
  subjectId: string;
  operation: string;
  idempotencyKey: string;
  serviceId: string;
  payload: unknown;
}

export interface AiTaskAdmissionContext {
  transaction: AtomicWriteContext;
  enqueue(input: AiTaskInput, options?: { reactivate?: boolean }): Promise<string>;
  cancelSubjects(subjectIds: readonly string[], reason: string): Promise<void>;
}

export interface StagedAiTaskAdmission<T> {
  value: T;
  commit(): void;
}

export interface AiExecutionLease {
  setActiveTaskCount(count: number): Promise<void>;
  onStopAll(listener: () => void): () => void;
  notifyTaskResult?(notification: AiTaskResultNotification): Promise<void>;
}

export interface AiTaskResultNotification {
  taskId: string;
  targetId: string;
  title: string;
  outcome: 'succeeded' | 'failed';
}

export interface AiTaskTerminalResult {
  task: AiTask;
  outcome: 'succeeded' | 'failed';
}

export type AiTaskTerminalHandler = (result: AiTaskTerminalResult) => Promise<void>;

interface RegisteredTaskHandler {
  handler: AiTaskHandler;
  onTerminal?: AiTaskTerminalHandler;
}

interface AiTaskRow {
  id: string;
  subject_id: string;
  operation: string;
  idempotency_key: string;
  service_id: string;
  payload_json: string;
  status: AiTaskStatus;
  attempt_count: number;
  not_before_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface ActiveTask {
  controller: AbortController;
  subjectKey: string;
}

const TASK_COLUMNS = 'id, subject_id, operation, idempotency_key, service_id, payload_json, status, attempt_count, not_before_at, error_code, error_message, created_at, updated_at';
const TASK_WATCH_HISTORY_LIMIT = 250;
export const AI_TASK_MAX_AUTOMATIC_RETRIES = 3;

export class AiTaskRunner {
  private readonly handlers = new Map<string, RegisteredTaskHandler>();
  private readonly active = new Map<string, ActiveTask>();
  private readonly activeSubjects = new Set<string>();
  private running = false;
  private scheduled = false;
  private dueTimer: ReturnType<typeof setTimeout> | null = null;
  private removeStopListener: (() => void) | null = null;

  constructor(
    private readonly database: LocalDatabase,
    private readonly workspaceId: string,
    private readonly executionLease: AiExecutionLease,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    const now = this.now().toISOString();
    await this.database.execute(
      `UPDATE ai_tasks SET status = 'interrupted', error_code = 'process-interrupted',
       error_message = '应用上次退出时任务尚未完成', updated_at = ?
       WHERE owner_id = ? AND deleted_at IS NULL AND status = 'running'`,
      [now, this.workspaceId],
    );
    const removeStopListener = this.executionLease.onStopAll(() => {
      void this.stopAll('已从系统通知停止');
    });
    this.removeStopListener = removeStopListener;
    this.running = true;
    this.schedule();
  }

  async dispose(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.clearDueTimer();
    this.removeStopListener?.();
    this.removeStopListener = null;
    for (const task of this.active.values()) task.controller.abort();
    this.active.clear();
    this.activeSubjects.clear();
    await this.executionLease.setActiveTaskCount(0).catch(() => undefined);
  }

  register(
    operation: string,
    handler: AiTaskHandler,
    options: { onTerminal?: AiTaskTerminalHandler } = {},
  ): () => void {
    const key = operation;
    const registration = { handler, ...options };
    this.handlers.set(key, registration);
    this.schedule();
    return () => {
      if (this.handlers.get(key) === registration) this.handlers.delete(key);
    };
  }

  async notifyTaskResult(notification: AiTaskResultNotification): Promise<void> {
    await this.executionLease.notifyTaskResult?.(notification);
  }

  async admit<T>(operation: (context: AiTaskAdmissionContext) => Promise<T>): Promise<T> {
    let admitted = false;
    const cancelledSubjects = new Set<string>();
    const output = await this.database.writeTransaction(async (transaction) => operation({
      transaction: createAtomicWriteContext(transaction),
      enqueue: async (input, options) => {
        admitted = true;
        return this.insertTask(transaction, input, options?.reactivate === true);
      },
      cancelSubjects: async (subjectIds, reason) => {
        const uniqueIds = [...new Set(subjectIds.filter(Boolean))];
        if (uniqueIds.length === 0) return;
        admitted = true;
        for (const subjectId of uniqueIds) cancelledSubjects.add(subjectId);
        const placeholders = uniqueIds.map(() => '?').join(', ');
        await transaction.execute(
          `UPDATE ai_tasks SET status = 'cancelled', error_code = 'stopped',
           error_message = ?, updated_at = ?
           WHERE owner_id = ? AND subject_id IN (${placeholders})
           AND deleted_at IS NULL AND status IN ('queued', 'running', 'interrupted')`,
          [reason.slice(0, 2_000), this.now().toISOString(), this.workspaceId, ...uniqueIds],
        );
      },
    }));
    if (cancelledSubjects.size > 0) {
      for (const task of this.active.values()) {
        if (cancelledSubjects.has(task.subjectKey)) task.controller.abort();
      }
    }
    if (admitted) this.schedule();
    return output;
  }

  async stageAdmission<T>(
    write: AtomicWriteContext,
    operation: (context: AiTaskAdmissionContext) => Promise<T>,
  ): Promise<StagedAiTaskAdmission<T>> {
    let admitted = false;
    let committed = false;
    const cancelledSubjects = new Set<string>();
    const transaction = sqlWriteContextOf(write);
    const value = await operation({
      transaction: write,
      enqueue: async (input, options) => {
        admitted = true;
        return this.insertTask(transaction, input, options?.reactivate === true);
      },
      cancelSubjects: async (subjectIds, reason) => {
        const uniqueIds = [...new Set(subjectIds.filter(Boolean))];
        if (uniqueIds.length === 0) return;
        admitted = true;
        for (const subjectId of uniqueIds) cancelledSubjects.add(subjectId);
        const placeholders = uniqueIds.map(() => '?').join(', ');
        await transaction.execute(
          `UPDATE ai_tasks SET status = 'cancelled', error_code = 'stopped',
           error_message = ?, updated_at = ?
           WHERE owner_id = ? AND subject_id IN (${placeholders})
           AND deleted_at IS NULL AND status IN ('queued', 'running', 'interrupted')`,
          [reason.slice(0, 2_000), this.now().toISOString(), this.workspaceId, ...uniqueIds],
        );
      },
    });
    return {
      value,
      commit: () => {
        if (committed) return;
        committed = true;
        for (const task of this.active.values()) {
          if (cancelledSubjects.has(task.subjectKey)) task.controller.abort();
        }
        if (admitted) this.schedule();
      },
    };
  }

  async enqueue(input: AiTaskInput): Promise<string> {
    return this.admit(({ enqueue }) => enqueue(input));
  }

  private async insertTask(
    transaction: SqlWriteContext,
    input: AiTaskInput,
    reactivate: boolean,
  ): Promise<string> {
    const id = await createDatabaseId(transaction, 'ai-task');
    const now = this.now().toISOString();
    await transaction.execute(
      `UPDATE ai_tasks SET status = 'cancelled', error_code = 'superseded',
       error_message = ?, updated_at = ?
       WHERE owner_id = ? AND subject_id = ? AND operation = ?
       AND idempotency_key != ? AND deleted_at IS NULL AND status IN ('interrupted', 'failed')`,
      ['已被新请求替代', now, this.workspaceId, input.subjectId, input.operation, input.idempotencyKey],
    );
    const insertion = await transaction.execute(
      `INSERT OR IGNORE INTO ai_tasks (id, owner_id, subject_id, operation, idempotency_key,
       service_id, payload_json, status, attempt_count, not_before_at, error_code, error_message,
       created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, NULL, NULL, NULL, ?, ?, NULL)`,
      [id, this.workspaceId, input.subjectId, input.operation, input.idempotencyKey, input.serviceId, JSON.stringify(input.payload), now, now],
    );
    let storedId = id;
    if (insertion.rowsAffected === 0) {
      const stored = await transaction.getOptional<{ id: string }>(
        'SELECT id FROM ai_tasks WHERE owner_id = ? AND idempotency_key = ?',
        [this.workspaceId, input.idempotencyKey],
      );
      if (!stored) throw new Error('AI 任务入队后无法读取');
      storedId = stored.id;
    }
    if (reactivate) {
      await transaction.execute(
        `UPDATE ai_tasks SET status = 'queued', attempt_count = 0, not_before_at = NULL,
         error_code = NULL, error_message = NULL, updated_at = ?
         WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
         AND status IN ('interrupted', 'failed', 'cancelled')`,
        [now, storedId, this.workspaceId],
      );
    }
    return storedId;
  }

  async resume(id: string): Promise<void> {
    await this.database.execute(
      `UPDATE ai_tasks SET status = 'queued', attempt_count = 0, not_before_at = NULL,
       error_code = NULL, error_message = NULL, updated_at = ?
       WHERE id = ? AND owner_id = ? AND deleted_at IS NULL AND status IN ('interrupted', 'failed', 'cancelled')`,
      [this.now().toISOString(), id, this.workspaceId],
    );
    this.schedule();
  }

  async stopSubject(subjectId: string, reason = '任务已停止'): Promise<void> {
    await this.database.execute(
      `UPDATE ai_tasks SET status = 'cancelled', error_code = 'stopped', error_message = ?, updated_at = ?
       WHERE owner_id = ? AND subject_id = ? AND deleted_at IS NULL AND status IN ('queued', 'running')`,
      [reason, this.now().toISOString(), this.workspaceId, subjectId],
    );
    for (const task of this.active.values()) {
      if (task.subjectKey === subjectId) task.controller.abort();
    }
    this.schedule();
  }

  async stopAll(reason = '任务已停止'): Promise<void> {
    await this.database.execute(
      `UPDATE ai_tasks SET status = 'cancelled', error_code = 'stopped', error_message = ?, updated_at = ?
       WHERE owner_id = ? AND deleted_at IS NULL AND status IN ('queued', 'running')`,
      [reason, this.now().toISOString(), this.workspaceId],
    );
    for (const task of this.active.values()) task.controller.abort();
    this.schedule();
  }

  async hasUnfinishedService(serviceId: string): Promise<boolean> {
    const row = await this.database.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ai_tasks
       WHERE owner_id = ? AND service_id = ? AND deleted_at IS NULL
       AND status IN ('queued', 'running', 'interrupted')`,
      [this.workspaceId, serviceId],
    );
    return Number(row.count) > 0;
  }

  watch(listener: (tasks: readonly AiTask[]) => void, onError: (error: Error) => void): () => void {
    const controller = new AbortController();
    this.database.watch<AiTaskRow>(
      `SELECT ${TASK_COLUMNS} FROM ai_tasks
       WHERE owner_id = ? AND deleted_at IS NULL
       AND (status IN ('queued', 'running', 'interrupted') OR id IN (
         SELECT id FROM ai_tasks WHERE owner_id = ? AND deleted_at IS NULL
         AND status IN ('succeeded', 'failed', 'cancelled')
         ORDER BY created_at DESC LIMIT ?
       ))
       ORDER BY created_at DESC`,
      [this.workspaceId, this.workspaceId, TASK_WATCH_HISTORY_LIMIT],
      {
        onResult: (rows) => listener(rows.map(mapTask)),
        onError: (error) => onError(safeDataError(error, 'AI 任务读取失败')),
      },
      { signal: controller.signal, triggerImmediate: true },
    );
    return () => controller.abort();
  }

  private schedule(): void {
    if (!this.running || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (!this.running) return;
    this.clearDueTimer();
    let rows: AiTaskRow[];
    try {
      rows = await this.database.getAll<AiTaskRow>(
        `SELECT ${TASK_COLUMNS} FROM ai_tasks
         WHERE owner_id = ? AND deleted_at IS NULL AND status = 'queued'
         ORDER BY created_at ASC`,
        [this.workspaceId],
      );
    } catch {
      this.scheduleAfter(1_000);
      return;
    }
    const nowMs = this.now().getTime();
    let earliestDue = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const dueMs = row.not_before_at ? Date.parse(row.not_before_at) : 0;
      if (Number.isFinite(dueMs) && dueMs > nowMs) {
        earliestDue = Math.min(earliestDue, dueMs);
        continue;
      }
      const task = mapTask(row);
      const registration = this.handlers.get(task.operation);
      const subjectKey = task.subjectId;
      if (!registration || this.activeSubjects.has(subjectKey)) continue;
      this.activeSubjects.add(subjectKey);
      const controller = new AbortController();
      this.active.set(task.id, { controller, subjectKey });
      void this.runActiveTask(task, registration, controller).then(() => {
        this.active.delete(task.id);
        this.activeSubjects.delete(subjectKey);
        void this.executionLease.setActiveTaskCount(this.active.size).catch(() => undefined);
        this.schedule();
      }, () => {
        this.active.delete(task.id);
        this.activeSubjects.delete(subjectKey);
        void this.executionLease.setActiveTaskCount(this.active.size).catch(() => undefined);
        this.scheduleAfter(1_000);
      });
    }
    if (Number.isFinite(earliestDue)) {
      const delay = Math.max(50, earliestDue - this.now().getTime());
      this.dueTimer = setTimeout(() => {
        this.dueTimer = null;
        this.schedule();
      }, delay);
    }
  }

  private async runActiveTask(
    task: AiTask,
    registration: RegisteredTaskHandler,
    controller: AbortController,
  ): Promise<void> {
    // The Android foreground-service lease supports execution conditions, but it
    // must not become a prerequisite for claiming otherwise runnable local work.
    await this.executionLease.setActiveTaskCount(this.active.size).catch(() => undefined);
    await this.execute(task, registration, controller);
  }

  private async execute(
    task: AiTask,
    registration: RegisteredTaskHandler,
    controller: AbortController,
  ): Promise<void> {
    const startedAt = this.now().toISOString();
    const claim = await this.database.execute(
      `UPDATE ai_tasks SET status = 'running', not_before_at = NULL, error_code = NULL,
       error_message = NULL, updated_at = ? WHERE id = ? AND owner_id = ? AND status = 'queued'`,
      [startedAt, task.id, this.workspaceId],
    );
    if (claim.rowsAffected !== 1) return;
    try {
      await registration.handler(
        { ...task, status: 'running', updatedAt: startedAt },
        { signal: controller.signal },
      );
      const completedAt = this.now().toISOString();
      const result = await this.database.execute(
        "UPDATE ai_tasks SET status = 'succeeded', updated_at = ? WHERE id = ? AND owner_id = ? AND status = 'running'",
        [completedAt, task.id, this.workspaceId],
      );
      if (result.rowsAffected === 1) await this.notifyTerminal(
        registration,
        { ...task, status: 'succeeded', updatedAt: completedAt },
        'succeeded',
      );
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        await this.database.execute(
          `UPDATE ai_tasks SET status = 'interrupted', error_code = 'stopped', error_message = ?, updated_at = ?
           WHERE id = ? AND owner_id = ? AND status = 'running'`,
          [messageOf(error, '任务已停止'), this.now().toISOString(), task.id, this.workspaceId],
        );
        return;
      }
      const retry = retryDetails(error, task.attemptCount);
      if (retry && task.attemptCount < AI_TASK_MAX_AUTOMATIC_RETRIES) {
        const due = new Date(this.now().getTime() + retry.delayMs).toISOString();
        await this.database.execute(
          `UPDATE ai_tasks SET status = 'queued', attempt_count = attempt_count + 1,
           not_before_at = ?, error_code = ?, error_message = ?, updated_at = ?
           WHERE id = ? AND owner_id = ? AND status = 'running'`,
          [due, retry.code, messageOf(error, 'AI 服务暂时不可用'), this.now().toISOString(), task.id, this.workspaceId],
        );
        return;
      }
      const failedAt = this.now().toISOString();
      const errorCode = error instanceof AiEngineError ? error.code : 'handler-failed';
      const errorMessage = messageOf(error, 'AI 任务失败');
      const result = await this.database.execute(
        `UPDATE ai_tasks SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?
         WHERE id = ? AND owner_id = ? AND status = 'running'`,
        [errorCode, errorMessage, failedAt, task.id, this.workspaceId],
      );
      if (result.rowsAffected === 1) await this.notifyTerminal(
        registration,
        {
          ...task,
          status: 'failed',
          errorCode,
          errorMessage,
          updatedAt: failedAt,
        },
        'failed',
      );
    }
  }

  private async notifyTerminal(
    registration: RegisteredTaskHandler,
    task: AiTask,
    outcome: AiTaskTerminalResult['outcome'],
  ): Promise<void> {
    try {
      await registration.onTerminal?.({ task, outcome });
    } catch {
      // Notification presentation must never change a durable task result.
    }
  }

  private clearDueTimer(): void {
    if (!this.dueTimer) return;
    clearTimeout(this.dueTimer);
    this.dueTimer = null;
  }

  private scheduleAfter(delayMs: number): void {
    if (!this.running || this.dueTimer) return;
    this.dueTimer = setTimeout(() => {
      this.dueTimer = null;
      this.schedule();
    }, delayMs);
  }
}

function mapTask(row: AiTaskRow): AiTask {
  let payload: unknown = null;
  try {
    payload = JSON.parse(row.payload_json) as unknown;
  } catch {
    payload = null;
  }
  return {
    id: row.id,
    subjectId: row.subject_id,
    operation: row.operation,
    idempotencyKey: row.idempotency_key,
    serviceId: row.service_id,
    payload,
    status: row.status,
    attemptCount: row.attempt_count,
    notBeforeAt: row.not_before_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function retryDetails(error: unknown, attemptCount: number): { code: string; delayMs: number } | null {
  if (!(error instanceof AiEngineError)) return null;
  if (!['timeout', 'unavailable', 'rate-limited'].includes(error.code)) return null;
  const fallback = [1_000, 5_000, 15_000][Math.min(attemptCount, 2)] ?? 15_000;
  return { code: error.code, delayMs: Math.max(fallback, error.retryAfterMs ?? 0) };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message.slice(0, 2_000) : fallback;
}
