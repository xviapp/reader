let stopLan: (() => Promise<void>) | null = null;

export function registerLanRestoreBarrier(stop: () => Promise<void>): void { stopLan = stop; }

/** Called after validation and before the first restore write, including image files. */
export async function stopReaderLanForRestore(): Promise<void> { await stopLan?.(); }
