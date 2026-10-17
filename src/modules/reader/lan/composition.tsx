import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore, type PropsWithChildren } from 'react';

import { useReaderRuntime } from '@/core/runtime/reader-runtime';
import type { ReaderLanController } from './application/lan-controller';
import { readerLanController } from './process-controller';

const Context = createContext<ReaderLanController | null>(null);

export function ReaderLanProvider({ children }: PropsWithChildren) {
  const runtime = useReaderRuntime();
  const [controller] = useState(readerLanController);
  useLayoutEffect(() => {
    controller.bindRuntime({ database: runtime.database, workspaceId: runtime.workspaceId, dataPhase: runtime.dataPhase });
  }, [controller, runtime.database, runtime.workspaceId, runtime.dataPhase]);
  useLayoutEffect(() => () => { void controller.stop('context-lost'); }, [controller]);
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}

export function useReaderLan() {
  const controller = useContext(Context);
  if (!controller) throw new Error('Reader LAN provider is missing');
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { controller, snapshot };
}
