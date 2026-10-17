import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { useLiveRows } from '@/core/ui/use-live-rows';

import { useReaderAi, useReaderRepositoryState, useReaderWorkspaceInstance } from '../composition';
import type { ReaderLibraryRepository } from '../application/ports';
import type { ReaderQuery, ReaderQuerySnapshot } from '../application/reader-query';
import type {
  ReaderBook,
  ReaderDiscussion,
  ReaderMessage,
  ReaderPassage,
  ReaderPassageIndex,
  ReaderPrompt,
  ReaderRole,
} from '../domain/model';

export type ReaderWorkspaceQueryName =
  | 'books'
  | 'passages'
  | 'discussions'
  | 'prompts'
  | 'roles'
  | 'favorites'
  | 'preferences';

const ALL_QUERIES: readonly ReaderWorkspaceQueryName[] = [
  'books', 'passages', 'discussions', 'prompts', 'roles', 'favorites', 'preferences',
];
const EMPTY_BOOKS: readonly ReaderBook[] = [];
const EMPTY_PASSAGES: readonly ReaderPassageIndex[] = [];
const EMPTY_DISCUSSIONS: readonly ReaderDiscussion[] = [];
const EMPTY_PROMPTS: readonly ReaderPrompt[] = [];
const EMPTY_ROLES: readonly ReaderRole[] = [];
const EMPTY_FAVORITES: readonly ReaderMessage[] = [];
const EMPTY_WORKSPACE_SNAPSHOT = { ready: false, error: null as string | null };
const NOOP_UNSUBSCRIBE = () => undefined;

export interface ReaderWorkspaceOptions {
  queries?: readonly ReaderWorkspaceQueryName[];
}

export function useReaderWorkspace(options: ReaderWorkspaceOptions = {}) {
  const reader = useReaderRepositoryState();
  const workspace = useReaderWorkspaceInstance();
  const ai = useReaderAi();
  const queries = options.queries ?? ALL_QUERIES;
  const hasQuery = useCallback((name: ReaderWorkspaceQueryName) => queries.includes(name), [queries]);

  const bootstrap = useSyncExternalStore(
    useCallback((listener) => workspace ? workspace.subscribe(listener) : NOOP_UNSUBSCRIBE, [workspace]),
    useCallback(() => workspace?.getSnapshot() ?? EMPTY_WORKSPACE_SNAPSHOT, [workspace]),
    useCallback(() => workspace?.getSnapshot() ?? EMPTY_WORKSPACE_SNAPSHOT, [workspace]),
  );
  const books = useReaderQuery(workspace && hasQuery('books') ? workspace.books : null, EMPTY_BOOKS);
  const passages = useReaderQuery(workspace && hasQuery('passages') ? workspace.passages : null, EMPTY_PASSAGES);
  const discussions = useReaderQuery(workspace && hasQuery('discussions') ? workspace.discussions : null, EMPTY_DISCUSSIONS);
  const prompts = useReaderQuery(workspace && hasQuery('prompts') ? workspace.prompts : null, EMPTY_PROMPTS);
  const roles = useReaderQuery(workspace && hasQuery('roles') ? workspace.roles : null, EMPTY_ROLES);
  const favorites = useReaderQuery(workspace && hasQuery('favorites') ? workspace.favorites : null, EMPTY_FAVORITES);
  const preferences = useReaderQuery(
    workspace && hasQuery('preferences') ? workspace.preferences : null,
    null,
  );

  const error = reader.dataError
    ?? bootstrap.error
    ?? books.error
    ?? passages.error
    ?? discussions.error
    ?? prompts.error
    ?? roles.error
    ?? favorites.error
    ?? preferences.error;
  const libraryLoading = books.loading || passages.loading;
  const discussionsLoading = books.loading || discussions.loading;
  const settingsLoading = prompts.loading || roles.loading || preferences.loading;
  const libraryError = books.error ?? passages.error;
  const discussionsError = books.error ?? discussions.error;
  const settingsError = prompts.error ?? roles.error ?? preferences.error;
  const queryLoading = (
    (hasQuery('books') && books.loading)
    || (hasQuery('passages') && passages.loading)
    || (hasQuery('discussions') && discussions.loading)
    || (hasQuery('prompts') && prompts.loading)
    || (hasQuery('roles') && roles.loading)
    || (hasQuery('favorites') && favorites.loading)
    || (hasQuery('preferences') && preferences.loading)
  );
  const queryError = (hasQuery('books') ? books.error : null)
    ?? (hasQuery('passages') ? passages.error : null)
    ?? (hasQuery('discussions') ? discussions.error : null)
    ?? (hasQuery('prompts') ? prompts.error : null)
    ?? (hasQuery('roles') ? roles.error : null)
    ?? (hasQuery('favorites') ? favorites.error : null)
    ?? (hasQuery('preferences') ? preferences.error : null);

  return {
    repository: reader.repository,
    ai,
    books: books.data,
    passages: passages.data,
    discussions: discussions.data,
    prompts: prompts.data,
    roles: roles.data,
    favorites: favorites.data,
    passagesLoading: passages.loading,
    passagesError: passages.error,
    retryPassages: passages.retry,
    discussionRowsLoading: discussions.loading,
    discussionRowsError: discussions.error,
    retryDiscussionRows: discussions.retry,
    favoritesLoading: favorites.loading,
    favoritesError: favorites.error,
    retryFavorites: favorites.retry,
    preferences: preferences.data,
    loading: libraryLoading || discussionsLoading,
    libraryLoading,
    discussionsLoading,
    settingsLoading,
    queryLoading,
    queryError,
    libraryError,
    discussionsError,
    settingsError,
    error,
    retry: workspace?.retry ?? NOOP_UNSUBSCRIBE,
  };
}

function useReaderQuery<T>(query: ReaderQuery<T> | null, empty: T): ReaderQuerySnapshot<T> & { retry: () => void } {
  const emptySnapshot = useMemo<ReaderQuerySnapshot<T>>(
    () => ({ data: empty, loading: false, error: null }),
    [empty],
  );
  const subscribe = useCallback(
    (listener: () => void) => query ? query.subscribe(listener) : NOOP_UNSUBSCRIBE,
    [query],
  );
  const getSnapshot = useCallback(
    () => query?.getSnapshot() ?? emptySnapshot,
    [emptySnapshot, query],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...snapshot, retry: query?.retry ?? NOOP_UNSUBSCRIBE };
}

export function useReaderPassage(repository: ReaderLibraryRepository | null, id: string | null) {
  const source = useMemo(() => repository && id ? { repository, passageId: id } : null, [id, repository]);
  const subscribe = useCallback((
    current: { repository: ReaderLibraryRepository; passageId: string },
    listener: (items: readonly ReaderPassage[]) => void,
    onError: (error: Error) => void,
  ) => current.repository.watchPassage(
    current.passageId,
    (item) => listener(item ? [item] : []),
    onError,
  ), []);
  const rows = useLiveRows(source, subscribe);
  return {
    item: rows.items[0] ?? null,
    loading: id !== null && rows.loading,
    error: rows.error,
    retry: rows.retry,
  };
}

export function useReaderPassages(repository: ReaderLibraryRepository | null, ids: readonly string[]) {
  const key = ids.join('\u0000');
  const [state, setState] = useState<{
    source: ReaderLibraryRepository | null;
    idsKey: string;
    items: readonly ReaderPassage[];
    loading: boolean;
    error: string | null;
  }>({ source: null, idsKey: '', items: [], loading: false, error: null });
  useEffect(() => {
    const uniqueIds = [...new Set(ids)];
    if (!repository || uniqueIds.length === 0) return undefined;
    let active = true;
    const items = new Map<string, ReaderPassage>();
    let settled = 0;
    const subscriptions = uniqueIds.map((id) => repository.watchPassage(
      id,
      (item) => {
        if (!active) return;
        settled += 1;
        if (item && item.deletedAt === null) items.set(id, item);
        else items.delete(id);
        setState({
          source: repository,
          idsKey: key,
          items: uniqueIds.map((itemId) => items.get(itemId)).filter((item): item is ReaderPassage => Boolean(item)),
          loading: settled < uniqueIds.length,
          error: null,
        });
      },
      (error) => {
        if (!active) return;
        setState((current) => ({
          ...current,
          source: repository,
          idsKey: key,
          loading: false,
          error: error.message || '摘录读取失败',
        }));
      },
    ));
    return () => {
      active = false;
      subscriptions.forEach((unsubscribe) => unsubscribe());
    };
  }, [key, repository, ids]);
  return {
    items: state.source === repository && state.idsKey === key ? state.items : [],
    loading: state.source === repository && state.idsKey === key ? state.loading : Boolean(repository && ids.length),
    error: state.source === repository && state.idsKey === key ? state.error : null,
    retry: () => setState((value) => ({ ...value, source: null, idsKey: '' })),
  };
}
