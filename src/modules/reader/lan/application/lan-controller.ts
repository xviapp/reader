import type { LocalDatabase } from '@/core/data/database-contract';

import { LanReadError, type LanReadRequest, type LanService, type LanSnapshot, type LanStopReason, type LanReplyEvent } from '../contracts';
import { LanReadRepository } from '../data/lan-read-repository';
import { observeLanChanges } from '../data/lan-invalidation-source';
import { LanSyncCoordinator } from './sync-coordinator';
import { readerLiveReplies, type ReaderLiveReplies } from '../../application/reader-live-replies';
import { projectLiveReply, projectReplyEvent } from '../adapters/reply-projection';

export interface LanNativePort {
  prepare(): Promise<LanService>;
  launch(serviceId: string): Promise<LanService>;
  stop(serviceId: string, reason: LanStopReason): Promise<void>;
  acknowledge(serviceId: string, changeSeq: number): Promise<void>;
  invalidate(serviceId: string, changeSeq: number): Promise<void>;
  publishReply(serviceId: string, json: string): Promise<void>;
  respond(serviceId: string, requestId: string, json: string, errorCode: string | null): Promise<void>;
}

interface RuntimeBinding { database: LocalDatabase | null; workspaceId: string; dataPhase: string }
interface ActiveService {
  service: LanService;
  abort: AbortController;
  database: LocalDatabase;
  workspaceId: string;
  observedGeneration: number;
  unsubscribeReplies(): void;
  reader: LanReadRepository;
  sync: LanSyncCoordinator;
  ended: Promise<void>;
  finish(): void;
}

const INITIAL: LanSnapshot = { phase: 'stopped', service: null, connectedPages: 0, lastStopReason: null, error: null };

export class ReaderLanController {
  private snapshot: LanSnapshot = INITIAL;
  private readonly listeners = new Set<() => void>();
  private runtime: RuntimeBinding | null = null;
  private active: ActiveService | null = null;
  private generation = 0;
  private startup: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;

  constructor(private readonly native: LanNativePort, private readonly replies: ReaderLiveReplies = readerLiveReplies) {}

  getSnapshot = (): LanSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  bindRuntime(runtime: RuntimeBinding): void {
    this.runtime = runtime;
    if (this.active && (runtime.dataPhase !== 'ready' || runtime.database !== this.active.database || runtime.workspaceId !== this.active.workspaceId)) {
      void this.stop('database-unavailable');
    }
  }

  start(): Promise<void> {
    if (this.startup) return this.startup;
    if (this.snapshot.phase !== 'stopped') return Promise.resolve();
    this.startup = this.startService().finally(() => { this.startup = null; });
    return this.startup;
  }

  private async startService(): Promise<void> {
    const runtime = this.runtime;
    if (!runtime?.database || runtime.dataPhase !== 'ready') {
      this.update({ ...INITIAL, error: '本地数据尚未准备好' });
      return;
    }
    const generation = ++this.generation;
    this.update({ ...INITIAL, phase: 'starting' });
    const deadline = setTimeout(() => { void this.stop('start-failed'); }, 5000);
    try {
      const service = await this.native.prepare();
      if (generation !== this.generation || this.runtime?.database !== runtime.database || this.runtime.workspaceId !== runtime.workspaceId || this.runtime.dataPhase !== 'ready') {
        await this.native.stop(service.serviceId, 'start-failed');
        if (generation === this.generation) await this.stop('database-unavailable');
        return;
      }
      let finish!: () => void;
      const ended = new Promise<void>((resolve) => { finish = resolve; });
      const active: ActiveService = {
        service, database: runtime.database, workspaceId: runtime.workspaceId, observedGeneration: 0, abort: new AbortController(), unsubscribeReplies: () => {},
        reader: new LanReadRepository(runtime.database, runtime.workspaceId),
        sync: new LanSyncCoordinator((seq) => {
          void this.native.invalidate(service.serviceId, seq).catch(() => { void this.stop('context-lost'); });
        }), ended, finish,
      };
      this.active = active;
      active.unsubscribeReplies = this.observeReplies(active);
      await observeLanChanges(active.database, active.abort.signal, () => {
        active.observedGeneration++; active.sync.invalidate();
      }, () => { void this.stop('database-unavailable'); });
      if (active.abort.signal.aborted) return;
      const runningService = await this.native.launch(service.serviceId);
      if (this.active === active && generation === this.generation) {
        active.service = runningService;
        this.update({ ...this.snapshot, phase: 'running', service: runningService });
      }
    } catch (error) {
      if (generation !== this.generation) return;
      await this.stop('start-failed');
      this.update({ ...this.snapshot, error: startError(error) });
    } finally { clearTimeout(deadline); }
  }

  stop(reason: LanStopReason = 'manual'): Promise<void> {
    if (this.stopping) return this.stopping;
    if (this.snapshot.phase === 'stopped') return Promise.resolve();
    this.generation += 1;
    const active = this.active;
    this.active = null;
    active?.abort.abort();
    active?.sync.stop();
    active?.unsubscribeReplies();
    this.update({ ...this.snapshot, phase: 'stopping', service: null, connectedPages: 0 });
    this.stopping = Promise.resolve().then(async () => {
      try { if (active) await this.native.stop(active.service.serviceId, reason); }
      finally {
        active?.finish();
        this.update({ ...INITIAL, lastStopReason: reason,
          error: reason === 'start-failed' ? '服务启动失败，请重试并检查 Wi-Fi、端口及后台运行条件' : null });
        this.stopping = null;
      }
    });
    return this.stopping;
  }

  onStopped(serviceId: string, reason: LanStopReason): void {
    if (this.active?.service.serviceId === serviceId) void this.stop(reason);
  }

  onPages(serviceId: string, count: number): void {
    if (this.active?.service.serviceId === serviceId) this.update({ ...this.snapshot, connectedPages: count });
  }

  async runHeadless(serviceId: string): Promise<void> {
    const active = this.active;
    if (!active || active.service.serviceId !== serviceId) return;
    await this.health(serviceId);
    await active.ended;
  }

  async health(serviceId: string): Promise<void> {
    const active = this.active;
    if (!active || active.service.serviceId !== serviceId) return;
    try {
      await active.database.get('SELECT 1');
      if (this.active === active && !active.abort.signal.aborted) await this.native.acknowledge(serviceId, active.sync.changeSeq);
    } catch { if (this.active === active) await this.stop('database-unavailable'); }
  }

  async request(request: LanReadRequest): Promise<void> {
    const active = this.active;
    if (!active || active.service.serviceId !== request.serviceId || active.abort.signal.aborted) return;
    let json = 'null';
    let errorCode: string | null = null;
    try {
      const { query, parameters } = request;
      if (query === 'live-replies') {
        const ids = await active.reader.pendingMessages(parameters);
        json = JSON.stringify(this.replies.snapshot(parameters.discussionId!, ids).map(projectLiveReply));
      } else {
        const allowed = ['books', 'book', 'passages', 'passage', 'folders', 'discussions', 'discussion', 'messages', 'message', 'favorites', 'search', 'media'];
        if (!allowed.includes(query)) throw new LanReadError('INVALID_REQUEST');
        json = JSON.stringify(await active.reader[query](parameters));
      }
    } catch (error) { errorCode = error instanceof LanReadError ? error.code : 'DATA_UNAVAILABLE'; }
    if (this.active === active && !active.abort.signal.aborted) {
      await this.native.respond(request.serviceId, request.requestId, json, errorCode).catch(() => undefined);
    }
  }

  private observeReplies(active: ActiveService): () => void {
    // Bound bridge work. A dropped delta produces an offset gap and a snapshot refresh.
    const queue: LanReplyEvent[] = [];
    let sending = false;
    const drain = async () => {
      if (sending) return;
      sending = true;
      try {
        while (queue.length && this.active === active && !active.abort.signal.aborted) {
          const event = queue.shift()!;
          const seq = active.observedGeneration;
          const visible = await active.reader.visibleMessageIds([event.messageId]);
          if (this.active === active && seq === active.observedGeneration && visible.has(event.messageId)) {
            await this.native.publishReply(active.service.serviceId, JSON.stringify(event));
          }
        }
      } catch { /* The database watcher and health check own failure handling. */ }
      finally { sending = false; }
    };
    const unsubscribe = this.replies.subscribe((event) => {
      if (queue.length >= 8) queue.shift();
      queue.push(projectReplyEvent(event)); void drain();
    });
    return () => { unsubscribe(); queue.length = 0; };
  }

  private update(snapshot: LanSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

function startError(error: unknown): string {
  // Native errors and stack traces never become HTTP responses or arbitrary UI text.
  const code = error instanceof Error ? error.message : '';
  if (code.includes('NO_WIFI')) return '请连接具有 IPv4 地址的 Wi-Fi 后重试';
  if (code.includes('NO_AVAILABLE_PORT')) return '未能找到可用端口，请稍后重新开启';
  if (code.includes('ASSETS_INVALID')) return '网页资源校验失败，请重新构建并安装应用';
  return '服务启动失败，请检查 Wi-Fi 和系统后台运行限制后重试';
}
