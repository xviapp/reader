import type { ReaderUnsubscribe } from './ports';

export interface ReaderQuerySnapshot<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

/** One database observation shared by all current consumers of a projection. */
export class ReaderQuery<T> {
  private snapshot: ReaderQuerySnapshot<T>;
  private readonly listeners = new Set<() => void>();
  private stop: ReaderUnsubscribe | null = null;
  private generation = 0;

  constructor(
    initial: T,
    private readonly observe: (next: (data: T) => void, error: (cause: Error) => void) => ReaderUnsubscribe,
  ) {
    this.snapshot = { data: initial, loading: true, error: null };
  }

  getSnapshot = (): ReaderQuerySnapshot<T> => this.snapshot;

  subscribe = (listener: () => void): ReaderUnsubscribe => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.disconnect();
    };
  };

  retry = (): void => {
    this.disconnect();
    if (this.listeners.size) this.start();
  };

  dispose(): void {
    this.disconnect();
  }

  private start(): void {
    const generation = ++this.generation;
    this.update({ ...this.snapshot, loading: true, error: null });
    try {
      this.stop = this.observe(
        (data) => {
          if (generation === this.generation) this.update({ data, loading: false, error: null });
        },
        (cause) => {
          if (generation === this.generation) this.update({ ...this.snapshot, loading: false, error: cause.message || '数据读取失败' });
        },
      );
    } catch (cause) {
      if (generation === this.generation) this.update({ ...this.snapshot, loading: false,
        error: cause instanceof Error ? cause.message : '数据读取失败' });
    }
  }

  private disconnect(): void {
    this.generation++;
    this.stop?.();
    this.stop = null;
  }

  private update(snapshot: ReaderQuerySnapshot<T>): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
