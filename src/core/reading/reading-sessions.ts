import type { KeyValueStorage } from '@/core/storage/local-state';

/** A running timer; `title` names it outside the book page (absent on timers from before it was kept). */
export interface ReadingSession { bookId: string; startedAt: string; title?: string }

export const READING_MIN_MS = 60_000;
/** A historical key, unchanged so running timers survive updates. */
export const READING_SESSIONS_KEY = 'reader.moment.sessions.v1';
/** The queue of a removed integration; cleared so its requests do not linger. */
export const LEGACY_MOMENT_OUTBOX_KEY = 'reader.moment.outbox.v1';

/** Reading timers per book; they survive the process so a session can end much later. */
export class ReadingSessions {
  private sessions: ReadingSession[] | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly storage: KeyValueStorage, private readonly now: () => number) {}

  async load(): Promise<void> {
    if (this.sessions) return;
    this.sessions = parseArray<ReadingSession>(await this.storage.getItem(READING_SESSIONS_KEY));
    this.emit();
  }

  /** Every running timer; empty until loaded. */
  all(): readonly ReadingSession[] {
    return this.sessions ?? [];
  }

  /** Null until loaded, then the active session of the book if any. */
  session(bookId: string): ReadingSession | null | undefined {
    if (!this.sessions) return undefined;
    return this.sessions.find((item) => item.bookId === bookId) ?? null;
  }

  async start(bookId: string, title?: string): Promise<ReadingSession> {
    await this.load();
    const existing = this.session(bookId);
    if (existing) return existing;
    const session = { bookId, startedAt: new Date(this.now()).toISOString(), ...(title ? { title } : {}) };
    await this.save([...this.sessions!, session]);
    return session;
  }

  /** Removes the session and returns it, whether it is then recorded or discarded. */
  async end(bookId: string): Promise<ReadingSession | null> {
    await this.load();
    const session = this.session(bookId) ?? null;
    if (session) await this.save(this.sessions!.filter((item) => item.bookId !== bookId));
    return session;
  }

  /** Drops the timers of books that no longer exist, e.g. after clearing or restoring data. */
  async retain(bookIds: ReadonlySet<string>): Promise<void> {
    await this.load();
    const kept = this.sessions!.filter((item) => bookIds.has(item.bookId));
    if (kept.length !== this.sessions!.length) await this.save(kept);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private async save(next: ReadingSession[]): Promise<void> {
    this.sessions = next; this.emit();
    await this.storage.setItem(READING_SESSIONS_KEY, JSON.stringify(next));
  }

  private emit(): void { for (const listener of this.listeners) listener(); }
}

/** The page of the latest excerpt, when its label is a plain page number. */
export function suggestedPage(pageLabels: readonly string[]): number | null {
  for (const label of pageLabels) {
    const match = /^\s*(?:第\s*)?(?:p\.?\s*)?(\d{1,5})\s*(?:页)?\s*$/iu.exec(label);
    if (match) return Number(match[1]);
  }
  return null;
}

function parseArray<T>(value: string | null): T[] {
  try {
    const parsed = value ? JSON.parse(value) as unknown : [];
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch { return []; }
}
