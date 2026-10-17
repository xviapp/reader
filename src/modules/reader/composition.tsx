import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type PropsWithChildren,
} from 'react';

import { createRepositoryContext } from '@/core/data/repository-context';
import { useReaderRuntime } from '@/core/runtime/reader-runtime';

import { ReaderAiCoordinator } from './application/reader-ai';
import type { ReaderRepository } from './application/ports';
import { ReaderWorkspace } from './application/reader-workspace';
import { LocalReaderRepository } from './data/reader-repository';

const repositoryContext = createRepositoryContext<ReaderRepository>('Reader', useReaderRuntime, ({ database, workspaceId }) => (
  new LocalReaderRepository(database, workspaceId)
));

const workspaceContext = createContext<ReaderWorkspace | null>(null);
const aiContext = createContext<ReaderAiCoordinator | null>(null);

function ReaderBindings({ children }: PropsWithChildren) {
  const reader = repositoryContext.useRepository();
  const runtime = useReaderRuntime();
  const workspace = useMemo(
    () => reader.repository ? new ReaderWorkspace(reader.repository) : null,
    [reader.repository],
  );
  const ai = useMemo(
    () => reader.repository
      ? new ReaderAiCoordinator(
        reader.repository,
        () => runtime.ai,
        runtime.aiTasks,
        () => runtime.defaultAiServiceId,
      )
      : null,
    [reader.repository, runtime.ai, runtime.aiTasks, runtime.defaultAiServiceId],
  );

  useEffect(() => {
    if (!workspace) return undefined;
    void workspace.start();
    return () => workspace.dispose();
  }, [workspace]);

  useEffect(() => () => ai?.stopAll(), [ai]);

  return (
    <workspaceContext.Provider value={workspace}>
      <aiContext.Provider value={ai}>{children}</aiContext.Provider>
    </workspaceContext.Provider>
  );
}

export function ReaderProvider({ children }: PropsWithChildren) {
  return (
    <repositoryContext.Provider>
      <ReaderBindings>{children}</ReaderBindings>
    </repositoryContext.Provider>
  );
}

export const useReaderRepositoryState = repositoryContext.useRepository;

export function useReaderWorkspaceInstance(): ReaderWorkspace | null {
  return useContext(workspaceContext);
}

export function useReaderAi(): ReaderAiCoordinator | null {
  return useContext(aiContext);
}
