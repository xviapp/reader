import type { LocalDatabase } from '@/core/data/database-contract';

export const LAN_OBSERVED_TABLES = [
  'reader_books', 'reader_passages', 'reader_folders', 'reader_discussions',
  'reader_discussion_sources', 'reader_messages', 'reader_message_sources',
] as const;

/** Every callback matters, including identical SELECT 1 results and parent cascades. */
export function observeLanChanges(database: LocalDatabase, signal: AbortSignal,
  invalidate: () => void, unavailable: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new Error('LAN observation stopped'));
    signal.addEventListener('abort', cancel, { once: true });
    database.watch('SELECT 1', [], {
      onResult() {
        if (signal.aborted) return;
        signal.removeEventListener('abort', cancel);
        invalidate();
        resolve();
      },
      onError() {
        signal.removeEventListener('abort', cancel);
        if (!signal.aborted) unavailable();
        reject(new Error('LAN data unavailable'));
      },
    }, { signal, tables: LAN_OBSERVED_TABLES, triggerImmediate: true });
  });
}
