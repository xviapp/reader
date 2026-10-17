import type { ReaderLiveReply, ReaderReplyEvent, ReaderReplyState } from './reply-events';

interface Entry extends ReaderLiveReply { generationId: string; sentLength: number }
const ENTRY_BYTES = 2 * 1024 * 1024;
const TOTAL_BYTES = 8 * 1024 * 1024;

/** Process-local previews. No database, network or LAN-service lifetime dependency. */
export class ReaderLiveReplies {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<(event: ReaderReplyEvent) => void>();
  private readonly epoch = Math.random().toString(36).slice(2);
  private serial = 0;
  private bytes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  start(discussionId: string, messageId: string): string {
    const generationId = `${this.epoch}-${++this.serial}`;
    this.remove(messageId);
    if (this.entries.size < 8) {
      const entry: Entry = { discussionId, messageId, generationId, version: 0, text: '',
        state: 'generating', previewAvailable: true, sentLength: 0 };
      this.entries.set(messageId, entry);
      this.state(entry, 'generating');
    }
    return generationId;
  }

  append(messageId: string, generationId: string, delta: string): void {
    const entry = this.current(messageId, generationId);
    if (!entry || !entry.previewAvailable || entry.state !== 'generating' || !delta) return;
    entry.version++;
    const size = delta.length * 2;
    if ((entry.text.length * 2) + size > ENTRY_BYTES || this.bytes + size > TOTAL_BYTES) {
      this.bytes -= entry.text.length * 2;
      entry.text = ''; entry.sentLength = 0; entry.previewAvailable = false;
      this.state(entry, 'generating');
      return;
    }
    entry.text += delta; this.bytes += size;
    if (this.listeners.size && this.timer === null) this.timer = setTimeout(() => this.flush(), 100);
  }

  committing(messageId: string, generationId: string): void {
    const entry = this.current(messageId, generationId);
    if (!entry) return;
    this.flush(); entry.version++; entry.state = 'committing'; this.state(entry, 'committing');
  }

  finish(messageId: string, generationId: string, state: 'completed' | 'failed'): void {
    const entry = this.current(messageId, generationId);
    if (!entry) return;
    this.flush(); entry.version++; this.state(entry, state); this.remove(messageId);
  }

  snapshot(discussionId: string, pendingIds: readonly string[]): readonly ReaderLiveReply[] {
    return pendingIds.map((messageId) => {
      const entry = this.entries.get(messageId);
      if (entry?.discussionId === discussionId) {
        const { sentLength: _sent, ...value } = entry;
        return value;
      }
      return { discussionId, messageId, generationId: null, version: 0, text: '',
        state: 'generating', previewAvailable: false };
    });
  }

  subscribe(listener: (event: ReaderReplyEvent) => void): () => void {
    if (!this.listeners.size) for (const entry of this.entries.values()) entry.sentLength = entry.text.length;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    };
  }

  private current(id: string, generation: string): Entry | undefined {
    const entry = this.entries.get(id);
    return entry?.generationId === generation ? entry : undefined;
  }
  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (entry) { this.bytes -= entry.text.length * 2; this.entries.delete(id); }
  }
  private state(entry: Entry, state: ReaderReplyState): void {
    this.emit({ type: 'reply-state', discussionId: entry.discussionId, messageId: entry.messageId,
      generationId: entry.generationId, version: entry.version, state, previewAvailable: entry.previewAvailable });
  }
  private flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    for (const entry of this.entries.values()) {
      if (entry.sentLength === entry.text.length) continue;
      this.emit({ type: 'reply-delta', discussionId: entry.discussionId, messageId: entry.messageId,
        generationId: entry.generationId, version: entry.version, offset: entry.sentLength,
        delta: entry.text.slice(entry.sentLength) });
      entry.sentLength = entry.text.length;
    }
  }
  private emit(event: ReaderReplyEvent): void {
    for (const listener of this.listeners) { try { listener(event); } catch { /* A preview cannot fail generation. */ } }
  }
}

export const readerLiveReplies = new ReaderLiveReplies();
