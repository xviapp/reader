import { useCallback, useEffect, useRef, useState } from 'react';

import { APP_CONFIG } from '@/core/app-config';
import { localState } from '@/core/storage/local-state';

import {
  conversationHasUnread,
  defaultReadingProgressEntry,
  emptyReadingProgressDocument,
  mergeReadingProgressEntry,
  normalizeReadingProgressDocument,
  type ReadingProgressPatch,
  type ReadingProgressDocument,
  type ReadingProgressEntry,
  safeReadingProgressKey,
} from './conversation-progress-core';

const STORAGE_PREFIX = APP_CONFIG.readingProgressPrefix;
const MAX_ENTRIES = 1_000;

export type { ReadingProgressPatch } from './conversation-progress-core';

interface ReadingProgressState {
  hydrated: boolean;
  value: ReadingProgressEntry | null;
  patch(value: ReadingProgressPatch): Promise<void>;
  clear(): Promise<void>;
}

const documents = new Map<string, ReadingProgressDocument>();
const loads = new Map<string, Promise<ReadingProgressDocument>>();
const queues = new Map<string, Promise<void>>();
const listeners = new Map<string, Set<() => void>>();
const entryEpochs = new Map<string, number>();

export function useReadingProgress(workspaceId: string, progressKey: string): ReadingProgressState {
  const identity = `${workspaceId}:${progressKey}`;
  const epoch = entryEpoch(identity);
  const [state, setState] = useState<{ identity: string; hydrated: boolean; value: ReadingProgressEntry | null }>(() => {
    const document = documents.get(workspaceId);
    return { identity, hydrated: document !== undefined, value: document?.entries[progressKey] ?? null };
  });

  useEffect(() => {
    let active = true;
    const refresh = () => {
      const document = documents.get(workspaceId);
      if (active && document) setState({ identity, hydrated: true, value: document.entries[progressKey] ?? null });
    };
    const unsubscribe = subscribe(workspaceId, refresh);
    void loadDocument(workspaceId).then(() => refresh()).catch(() => {
      if (active) setState({ identity, hydrated: true, value: null });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [identity, progressKey, workspaceId]);

  const patch = useCallback((value: ReadingProgressPatch) => (
    updateEntry(workspaceId, progressKey, value, epoch)
  ), [epoch, progressKey, workspaceId]);
  const clear = useCallback(() => removeEntry(workspaceId, progressKey), [progressKey, workspaceId]);
  return {
    hydrated: state.identity === identity && state.hydrated,
    value: state.identity === identity ? state.value : null,
    patch,
    clear,
  };
}

export function useConversationUnread(
  workspaceId: string,
  progressKey: string,
  latestReadableId: string | null,
  enabled = true,
): boolean {
  const progress = useReadingProgress(workspaceId, progressKey);
  const identity = `${workspaceId}:${progressKey}`;
  const baselineIdentity = useRef<string | null>(null);

  useEffect(() => {
    if (progress.value !== null) {
      baselineIdentity.current = null;
      return;
    }
    if (!enabled || !progress.hydrated || progress.value !== null || baselineIdentity.current === identity) return;
    baselineIdentity.current = identity;
    void progress.patch({
      anchorId: null,
      anchorOffset: 0,
      anchorIndex: 0,
      atLatest: true,
      readId: latestReadableId,
    }).catch(() => {
      if (baselineIdentity.current === identity) baselineIdentity.current = null;
    });
  }, [enabled, identity, latestReadableId, progress]);

  return enabled && progress.hydrated && conversationHasUnread(progress.value, latestReadableId);
}

export function clearReadingProgress(workspaceId: string, progressKey: string): Promise<void> {
  return removeEntry(workspaceId, progressKey);
}

export function ensureReadingProgressBaseline(
  workspaceId: string,
  progressKey: string,
  latestReadableId: string | null,
): Promise<void> {
  if (!safeReadingProgressKey(progressKey)) return Promise.reject(new Error('Reading progress key is invalid'));
  const identity = `${workspaceId}:${progressKey}`;
  const expectedEpoch = entryEpoch(identity);
  return enqueue(workspaceId, async () => {
    if (entryEpoch(identity) !== expectedEpoch) return;
    const current = await loadDocument(workspaceId);
    if (entryEpoch(identity) !== expectedEpoch || current.entries[progressKey]) return;
    const entry = mergeReadingProgressEntry(null, {
      anchorId: null,
      anchorOffset: 0,
      anchorIndex: 0,
      atLatest: true,
      readId: latestReadableId,
    }, new Date().toISOString());
    const next: ReadingProgressDocument = {
      ...current,
      entries: pruneEntries({ ...current.entries, [progressKey]: entry }),
    };
    documents.set(workspaceId, next);
    notify(workspaceId);
    await localState.setItem(storageKey(workspaceId), JSON.stringify(next));
  });
}

async function loadDocument(workspaceId: string): Promise<ReadingProgressDocument> {
  const cached = documents.get(workspaceId);
  if (cached) return cached;
  const pending = loads.get(workspaceId);
  if (pending) return pending;
  const load = localState.getItem(storageKey(workspaceId)).then((raw) => {
    if (!raw) return emptyReadingProgressDocument();
    try {
      return normalizeReadingProgressDocument(JSON.parse(raw) as unknown);
    } catch {
      return emptyReadingProgressDocument();
    }
  }).catch(() => emptyReadingProgressDocument()).then((document) => {
    documents.set(workspaceId, document);
    loads.delete(workspaceId);
    return document;
  });
  loads.set(workspaceId, load);
  return load;
}

function updateEntry(workspaceId: string, progressKey: string, patch: ReadingProgressPatch, expectedEpoch: number): Promise<void> {
  if (!safeReadingProgressKey(progressKey)) return Promise.reject(new Error('Reading progress key is invalid'));
  return enqueue(workspaceId, async () => {
    if (entryEpoch(`${workspaceId}:${progressKey}`) !== expectedEpoch) return;
    const current = await loadDocument(workspaceId);
    if (entryEpoch(`${workspaceId}:${progressKey}`) !== expectedEpoch) return;
    const entry = mergeReadingProgressEntry(
      current.entries[progressKey] ?? defaultReadingProgressEntry(),
      patch,
      new Date().toISOString(),
    );
    const entries = pruneEntries({ ...current.entries, [progressKey]: entry });
    const next: ReadingProgressDocument = { ...current, entries };
    documents.set(workspaceId, next);
    notify(workspaceId);
    await localState.setItem(storageKey(workspaceId), JSON.stringify(next));
  });
}

function removeEntry(workspaceId: string, progressKey: string): Promise<void> {
  const identity = `${workspaceId}:${progressKey}`;
  entryEpochs.set(identity, entryEpoch(identity) + 1);
  return enqueue(workspaceId, async () => {
    const current = await loadDocument(workspaceId);
    if (!current.entries[progressKey]) {
      notify(workspaceId);
      return;
    }
    const entries = { ...current.entries };
    delete entries[progressKey];
    const next: ReadingProgressDocument = { ...current, entries };
    documents.set(workspaceId, next);
    notify(workspaceId);
    await localState.setItem(storageKey(workspaceId), JSON.stringify(next));
  });
}

function entryEpoch(identity: string): number {
  return entryEpochs.get(identity) ?? 0;
}

function enqueue(workspaceId: string, operation: () => Promise<void>): Promise<void> {
  const previous = queues.get(workspaceId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  queues.set(workspaceId, next);
  void next.finally(() => {
    if (queues.get(workspaceId) === next) queues.delete(workspaceId);
  }).catch(() => undefined);
  return next;
}

function subscribe(workspaceId: string, listener: () => void): () => void {
  const workspaceListeners = listeners.get(workspaceId) ?? new Set<() => void>();
  workspaceListeners.add(listener);
  listeners.set(workspaceId, workspaceListeners);
  return () => {
    workspaceListeners.delete(listener);
    if (workspaceListeners.size === 0) listeners.delete(workspaceId);
  };
}

function notify(workspaceId: string): void {
  for (const listener of listeners.get(workspaceId) ?? []) listener();
}

function pruneEntries(entries: Record<string, ReadingProgressEntry>): Record<string, ReadingProgressEntry> {
  const ordered = Object.entries(entries).sort((left, right) => right[1].updatedAt.localeCompare(left[1].updatedAt));
  return Object.fromEntries(ordered.slice(0, MAX_ENTRIES));
}

function storageKey(workspaceId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(workspaceId)}`;
}
