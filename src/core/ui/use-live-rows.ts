import { useEffect, useState } from 'react';

export type LiveRowsSubscriber<Repository, Item> = (
  repository: Repository,
  listener: (items: readonly Item[]) => void,
  onError: (error: Error) => void,
) => () => void;

type LiveRowsCacheKey = string;

export function useLiveRows<Repository extends object, Item>(
  repository: Repository | null,
  subscribe: LiveRowsSubscriber<Repository, Item>,
  getCacheKey?: (repository: Repository) => LiveRowsCacheKey,
) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    source: Repository | null;
    cacheKey: LiveRowsCacheKey | null;
    items: readonly Item[];
    error: string | null;
  }>({ source: null, cacheKey: null, items: [], error: null });
  // Some screens switch between keyed projections (for example, the
  // recommendation and hot feeds) while keeping the same repository alive.
  // Retain each projection in memory so the next subscription can render its
  // previous rows synchronously instead of flashing an empty state.
  const [snapshots] = useState(() => new WeakMap<object, Map<LiveRowsCacheKey, readonly Item[]>>());
  const cacheKey = repository && getCacheKey ? getCacheKey(repository) : null;
  const current = state.source === repository && state.cacheKey === cacheKey;
  const cached = repository && cacheKey !== null
    ? snapshots.get(repository)?.get(cacheKey)
    : undefined;

  useEffect(() => {
    if (!repository) return;
    const sourceCacheKey = getCacheKey ? getCacheKey(repository) : null;
    const remember = (items: readonly Item[]) => {
      if (sourceCacheKey !== null) {
        const byKey = snapshots.get(repository) ?? new Map<LiveRowsCacheKey, readonly Item[]>();
        byKey.set(sourceCacheKey, items);
        snapshots.set(repository, byKey);
      }
      setState({ source: repository, cacheKey: sourceCacheKey, items, error: null });
    };
    return subscribe(
      repository,
      remember,
      (error) => setState((currentState) => ({
        source: repository,
        cacheKey: sourceCacheKey,
        items: currentState.source === repository && currentState.cacheKey === sourceCacheKey
          ? currentState.items
          : sourceCacheKey === null
            ? []
            : snapshots.get(repository)?.get(sourceCacheKey) ?? [],
        error: error.message || '数据读取失败',
      })),
    );
  }, [getCacheKey, repository, revision, snapshots, subscribe]);

  return {
    items: current ? state.items : cached ?? [],
    loading: repository !== null && !current && cached === undefined,
    error: current ? state.error : null,
    retry: () => {
      setState((value) => ({ ...value, source: null, cacheKey: null, error: null }));
      setRevision((value) => value + 1);
    },
  };
}

