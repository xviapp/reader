import { useEffect, useReducer, useState } from 'react';
import { READING_MIN_MS, type ReadingSession } from '@/core/reading/reading-sessions';
import { endReadingSession, readingSessions, startReadingSession } from '@/core/reading/reading-session-store.native';

import type { ReaderLibraryRepository } from '../application/ports';

/** Every running timer, with a clock that ticks each second while any runs. */
export function useReadingTimers() {
  const sessions = readingSessions();
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const stop = sessions.subscribe(refresh);
    void sessions.load();
    return stop;
  }, [sessions]);
  const running = sessions.all().length > 0;
  useEffect(() => {
    if (!running) return undefined;
    // A fresh session shows 0 until the first tick; negative spans clamp to 0.
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [running]);
  return {
    sessions: sessions.all(),
    now,
    /** Brings the clock up to date, e.g. before deciding whether a session is recorded. */
    refresh: () => setNow(Date.now()),
  };
}

/** The book's reading timer. */
export function useReadingSession(bookId: string, title: string) {
  const timers = useReadingTimers();
  const session = timers.sessions.find((item) => item.bookId === bookId) ?? null;
  const elapsedMs = session ? elapsedOf(session, timers.now) : 0;
  return {
    session,
    /** Running timers of other books. */
    others: timers.sessions.filter((item) => item.bookId !== bookId),
    elapsedMs,
    minutes: Math.floor(elapsedMs / 60_000),
    /** The running time as m:ss, or h:mm:ss past an hour. */
    elapsed: readingElapsedLabel(elapsedMs),
    start: () => startReadingSession(bookId, title),
    refresh: timers.refresh,
  };
}

/** Keeps a finished timer with the book when it lasted a minute, then ends it. */
export async function keepReadingSession(
  repository: Pick<ReaderLibraryRepository, 'recordReadingSession'>,
  book: { id: string },
  session: ReadingSession,
  pages: { startPage: number | null; endPage: number | null },
  endedAt: number,
): Promise<void> {
  // Kept before the timer ends, so a failed write leaves the timer running for another try.
  if (endedAt - Date.parse(session.startedAt) >= READING_MIN_MS) {
    await repository.recordReadingSession(book.id, { startedAt: session.startedAt, endedAt: new Date(endedAt).toISOString(), ...pages });
  }
  await endReadingSession(book.id);
}

export function elapsedOf(session: ReadingSession, now: number): number {
  return Math.max(0, now - Date.parse(session.startedAt));
}

export function readingElapsedLabel(ms: number): string {
  const totalSeconds = Math.floor(ms / 1_000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}
