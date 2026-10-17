import { localState } from '@/core/storage/local-state';
import { LEGACY_MOMENT_OUTBOX_KEY, ReadingSessions, type ReadingSession } from './reading-sessions';
import { requestReadingNotificationPermission, syncReadingNotifications } from './reading-notification.native';

const READING_GLOBAL_KEY = '__readerReadingSessionsV1';
type ReadingGlobal = typeof globalThis & { [READING_GLOBAL_KEY]?: ReadingSessions };

/** One timer store per JS process. */
export function readingSessions(): ReadingSessions {
  const readingGlobal = globalThis as ReadingGlobal;
  const existing = readingGlobal[READING_GLOBAL_KEY];
  if (existing) return existing;
  const sessions = new ReadingSessions(localState, () => Date.now());
  // The ongoing notifications follow the timers wherever they change: book page, shelf, trash, restore.
  sessions.subscribe(() => syncReadingNotifications(sessions.all()));
  void sessions.load();
  void localState.removeItem(LEGACY_MOMENT_OUTBOX_KEY).catch(() => undefined);
  readingGlobal[READING_GLOBAL_KEY] = sessions;
  return sessions;
}

/** Starts the book's timer; the first start asks for permission to show it as a notification. */
export async function startReadingSession(bookId: string, title: string): Promise<void> {
  await readingSessions().start(bookId, title);
  if (await requestReadingNotificationPermission()) syncReadingNotifications(readingSessions().all());
}

/** Ends the book's timer and returns it, whether it is then recorded or discarded. */
export function endReadingSession(bookId: string): Promise<ReadingSession | null> {
  return readingSessions().end(bookId);
}

/** Stops the book's timer without keeping it, e.g. when the book goes to the trash. */
export async function discardReadingSession(bookId: string): Promise<void> {
  await readingSessions().end(bookId);
}

/** Keeps only the timers of these books; the rest point at books that were cleared or replaced. */
export async function retainReadingSessions(bookIds: ReadonlySet<string>): Promise<void> {
  await readingSessions().retain(bookIds);
}
