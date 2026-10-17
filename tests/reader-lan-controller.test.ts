import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalDatabase, QueryObserver, QueryWatchOptions } from '@/core/data/database-contract';
import { ReaderLanController, type LanNativePort } from '@/modules/reader/lan/application/lan-controller';
import { LAN_OBSERVED_TABLES } from '@/modules/reader/lan/data/lan-invalidation-source';

afterEach(() => vi.useRealTimers());
function fixture() {
  let observer!: QueryObserver<unknown>;
  let watchOptions!: QueryWatchOptions;
  const database = {
    get: vi.fn(async () => ({ value: 1 })),
    getAll: vi.fn(async () => []),
    watch: vi.fn((_sql, _params, observed, options) => {
      observer = observed; watchOptions = options; observer.onResult([{ value: 1 }]);
    }),
  } as unknown as LocalDatabase;
  const native: LanNativePort = {
    prepare: vi.fn(async () => ({ serviceId: 'service-1', address: 'http://192.168.1.5:9527', code: '012345' })),
    launch: vi.fn(async () => ({ serviceId: 'service-1', address: 'http://192.168.1.5:9527', code: '012345' })),
    stop: vi.fn(async () => undefined), acknowledge: vi.fn(async () => undefined),
    invalidate: vi.fn(async () => undefined), respond: vi.fn(async () => undefined), publishReply: vi.fn(async () => undefined),
  };
  const controller = new ReaderLanController(native);
  controller.bindRuntime({ database, workspaceId: 'local', dataPhase: 'ready' });
  return { database, native, controller, observer: () => observer, options: () => watchOptions };
}

describe('LAN lifecycle and observation', () => {
  it('observes parent tables, handles equal SELECT 1 results and throttles continuous changes', async () => {
    vi.useFakeTimers();
    const { controller, native, observer, options } = fixture();
    await controller.start();
    expect(options().tables).toEqual(LAN_OBSERVED_TABLES);
    for (let time = 0; time < 300; time += 20) { observer().onResult([{ value: 1 }]); await vi.advanceTimersByTimeAsync(20); }
    expect(native.invalidate).toHaveBeenCalledTimes(3);
    await controller.stop();
    expect(options().signal?.aborted).toBe(true);
    observer().onResult([{ value: 1 }]);
    await vi.advanceTimersByTimeAsync(200);
    expect(native.invalidate).toHaveBeenCalledTimes(3);
  });
  it('stops on database replacement and discards late query results', async () => {
    const { controller, native, database } = fixture();
    let complete!: (value: never[]) => void;
    vi.mocked(database.getAll).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    await controller.start();
    const pending = controller.request({ serviceId: 'service-1', requestId: 'query-1', query: 'books', parameters: {} });
    controller.bindRuntime({ database: null, workspaceId: 'local', dataPhase: 'initializing' });
    await controller.stop();
    complete([]); await pending;
    expect(native.respond).not.toHaveBeenCalled();
    expect(native.stop).toHaveBeenCalledWith('service-1', 'database-unavailable');
    expect(controller.getSnapshot().service).toBeNull();
  });
  it('does not resurrect an instance stopped before prepare resolves', async () => {
    const { controller, native } = fixture();
    let prepared!: (value: { serviceId: string; address: string; code: string }) => void;
    vi.mocked(native.prepare).mockImplementationOnce(() => new Promise((resolve) => { prepared = resolve; }));
    const start = controller.start();
    await controller.stop('manual');
    prepared({ serviceId: 'old', address: 'address', code: '000000' });
    await start;
    expect(native.launch).not.toHaveBeenCalled();
    expect(native.stop).toHaveBeenCalledWith('old', 'start-failed');
    await controller.start();
    expect(controller.getSnapshot().phase).toBe('running');
    await controller.stop();
    expect(controller.getSnapshot().phase).toBe('stopped');
  });
  it('ends the headless task and observation when the source fails', async () => {
    const { controller, native, observer } = fixture();
    await controller.start();
    const task = controller.runHeadless('service-1');
    await Promise.resolve();
    expect(native.acknowledge).toHaveBeenCalled();
    observer().onError(new Error('private provider error'));
    await task;
    expect(controller.getSnapshot().phase).toBe('stopped');
    expect(controller.getSnapshot().lastStopReason).toBe('database-unavailable');
  });
  it('returns to stopped when the workspace changes during prepare', async () => {
    const { controller, native, database } = fixture();
    let prepared!: (value: { serviceId: string; address: string; code: string }) => void;
    vi.mocked(native.prepare).mockImplementationOnce(() => new Promise((resolve) => { prepared = resolve; }));
    const pending = controller.start();
    controller.bindRuntime({ database, workspaceId: 'different-workspace', dataPhase: 'ready' });
    prepared({ serviceId: 'old', address: 'address', code: '000000' }); await pending;
    expect(native.launch).not.toHaveBeenCalled();
    expect(controller.getSnapshot().phase).toBe('stopped');
    expect(controller.getSnapshot().lastStopReason).toBe('database-unavailable');
  });
  it('publishes the actual automatically selected port only after launch succeeds', async () => {
    const { controller, native } = fixture();
    vi.mocked(native.launch).mockResolvedValue({ serviceId: 'service-1', address: 'http://192.168.1.5:9529', code: '012345' });
    await controller.start();
    expect(native.prepare).toHaveBeenCalledWith();
    expect(controller.getSnapshot().service?.address).toBe('http://192.168.1.5:9529');
    await controller.stop();
  });
});
