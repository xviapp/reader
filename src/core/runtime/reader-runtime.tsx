import { createContext, useContext, useEffect, useSyncExternalStore, type PropsWithChildren } from 'react';
import type { LocalDatabase } from '@/core/data/database-contract';
import { createReaderRuntime } from './reader-runtime-native';
import { processReaderRuntime, type ReaderRuntime, type ReaderRuntimeSnapshot } from './runtime';

export type { PublicAiConfiguration, ReaderAiPhase, ReaderDataPhase } from './runtime';
export type ReaderRuntimeValue = ReaderRuntimeSnapshot & Pick<ReaderRuntime,
  'retryData' | 'saveAiService' | 'setDefaultAiService' | 'removeAiService' | 'testAiService'>;
const RuntimeContext = createContext<ReaderRuntimeValue | null>(null);

export function ReaderRuntimeProvider({ children }: PropsWithChildren) {
  const runtime = processReaderRuntime(createReaderRuntime);
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  useEffect(() => { void runtime.start(); }, [runtime]);
  return (
    <RuntimeContext.Provider value={{
      ...snapshot, retryData: runtime.retryData, saveAiService: runtime.saveAiService,
      setDefaultAiService: runtime.setDefaultAiService, removeAiService: runtime.removeAiService,
      testAiService: runtime.testAiService,
    }}>{children}</RuntimeContext.Provider>
  );
}

export function useReaderRuntime(): ReaderRuntimeValue {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('useReaderRuntime must be used inside ReaderRuntimeProvider');
  return runtime;
}

export function useReadyReaderRuntime(): ReaderRuntimeValue & { database: LocalDatabase } {
  const runtime = useReaderRuntime();
  if (runtime.dataPhase !== 'ready' || !runtime.database) {
    throw new Error('useReadyReaderRuntime requires database to be initialized and ready');
  }
  return runtime as ReaderRuntimeValue & { database: LocalDatabase };
}

export function useReaderDatabase(): LocalDatabase {
  return useReadyReaderRuntime().database;
}

