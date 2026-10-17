import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from 'react';

import type { LocalDatabase } from '@/core/data/database-contract';

interface DataRuntimeSnapshot {
  database: LocalDatabase | null;
  workspaceId: string;
  dataPhase: string;
  dataError: string | null;
  retryData(): void;
}

export interface RepositoryState<Repository> {
  repository: Repository | null;
  dataPhase: string;
  dataError: string | null;
  retryData(): void;
}

interface RepositoryFactoryInput {
  database: LocalDatabase;
  workspaceId: string;
}

export function createRepositoryContext<Repository>(
  name: string,
  useRuntime: () => DataRuntimeSnapshot,
  createRepository: (input: RepositoryFactoryInput) => Repository,
) {
  const Context = createContext<RepositoryState<Repository> | null>(null);
  Context.displayName = `${name}RepositoryContext`;

  function Provider({ children }: PropsWithChildren) {
    const runtime = useRuntime();
    const repository = useMemo(
      () => runtime.database
        ? createRepository({ database: runtime.database, workspaceId: runtime.workspaceId })
        : null,
      [runtime.database, runtime.workspaceId],
    );
    const value = useMemo<RepositoryState<Repository>>(() => ({
      repository,
      dataPhase: runtime.dataPhase,
      dataError: runtime.dataError,
      retryData: runtime.retryData,
    }), [repository, runtime.dataError, runtime.dataPhase, runtime.retryData]);
    return <Context.Provider value={value}>{children}</Context.Provider>;
  }

  function useRepository(): RepositoryState<Repository> {
    const value = useContext(Context);
    if (!value) throw new Error(`${name} UI must be rendered inside its repository provider`);
    return value;
  }

  return { Provider, useRepository };
}
