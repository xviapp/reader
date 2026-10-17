import { requireOptionalNativeModule } from 'expo';

import type { ReadingSession } from './reading-sessions';

interface ReadingNotificationModule {
  requestPermission(): Promise<boolean>;
  sync(timers: readonly { bookId: string; title: string; startedAt: number }[]): boolean;
}

const native = requireOptionalNativeModule<ReadingNotificationModule>('ReadingNotification');

/** Shows one ongoing notification per running timer and removes the rest; a no-op without the native module. */
export function syncReadingNotifications(sessions: readonly ReadingSession[]): void {
  if (!native) return;
  try {
    native.sync(sessions.map((session) => ({ bookId: session.bookId, title: session.title ?? '', startedAt: Date.parse(session.startedAt) })));
  } catch (cause) {
    // The notification only reminds; the timer itself never depends on it.
    console.warn('阅读计时通知失败', cause);
  }
}

/** Asks once for Android 13's notification permission, when a timer first starts. */
export async function requestReadingNotificationPermission(): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.requestPermission();
  } catch {
    return false;
  }
}
