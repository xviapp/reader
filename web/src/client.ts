import { createParser } from 'eventsource-parser';
import { READER_LAN_PROTOCOL_VERSION, type LanEnvelope, type LanEvent, type LanLiveReply, type LanPage, type LanReplyEvent } from '../../src/modules/reader/lan/contracts';

export type ConnectionPhase = 'login' | 'connecting' | 'online' | 'offline' | 'ended' | 'full';
interface Connection { phase: ConnectionPhase; message: string; loading: boolean }
export interface QueryState<T> { data: T | null; loading: boolean; error: string }
class HttpError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }

/** Each visible query owns its pages and request generation; invalidations stay dirty in flight. */
export class LanQuery<T> {
  private state: QueryState<T> = { data: null, loading: false, error: '' };
  private listeners = new Set<() => void>();
  private dirty = true;
  private fetching = false;
  private epoch = 0;
  private accessedAt = 0;
  private pages = 1;
  private retry: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly client: LanClient, readonly path: string, private readonly pagination: 'none' | 'forward' | 'history') {}
  getSnapshot = (): QueryState<T> => this.state;
  get observed(): boolean { return this.listeners.size > 0; }
  get lastAccessed(): number { return this.accessedAt; }
  touch(accessedAt: number): void { this.accessedAt = accessedAt; }
  subscribe = (callback: () => void): (() => void) => {
    const wasObserved = this.observed;
    this.listeners.add(callback);
    if (!wasObserved) this.client.observe(this);
    this.invalidate();
    return () => {
      this.listeners.delete(callback);
      if (!this.observed) { this.client.unobserve(this); this.epoch++; }
    };
  };
  invalidate(): void { this.dirty = true; void this.refresh(); }
  loadMore = (): void => {
    if (this.state.loading || !(this.state.data as LanPage<unknown> | null)?.nextCursor) return;
    this.pages++; this.invalidate();
  };
  reset(): void {
    this.epoch++; this.pages = 1; this.dirty = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null; this.set({ data: null, error: '', loading: false });
  }
  apply(transform: (data: T | null) => T | null): void {
    this.epoch++;
    this.set({ data: transform(this.state.data) });
  }
  private async refresh(): Promise<void> {
    if (this.fetching || !this.observed || !this.client.online || !this.dirty) return;
    this.fetching = true; this.set({ loading: true });
    try {
      while (this.dirty && this.observed && this.client.online) {
        this.dirty = false;
        const epoch = this.epoch;
        let data: T | null = null;
        let cursor: string | null = null;
        const items: unknown[] = [];
        for (let page = 0; page < this.pages; page++) {
          const url = new URL(this.path, location.origin);
          if (cursor) url.searchParams.set('cursor', cursor);
          const value: T = await this.client.read(url.pathname + url.search);
          if (this.pagination === 'none') { data = value; break; }
          const batch = value as LanPage<unknown>;
          if (this.pagination === 'history') items.unshift(...batch.items);
          else items.push(...batch.items);
          cursor = batch.nextCursor;
          data = { items: [...items], nextCursor: cursor } as T;
          if (!cursor) break;
        }
        if (epoch === this.epoch && !this.dirty && this.client.online) this.set({ data, error: '' });
      }
    } catch (error) {
      this.dirty = true;
      if (error instanceof HttpError && error.status === 404) {
        this.dirty = false; this.set({ data: null, error: '内容已删除或不可访问' });
      } else if (error instanceof HttpError && error.status === 401) this.client.expired();
      else if (this.client.online) {
        this.set({ error: '读取暂未完成，正在重试' });
        this.retry = setTimeout(() => { this.retry = null; void this.refresh(); }, 800 + Math.random() * 500);
      }
    } finally {
      this.fetching = false; this.set({ loading: false });
      if (this.dirty && this.client.online && !this.retry) void this.refresh();
    }
  }
  private set(value: Partial<QueryState<T>>): void {
    this.state = { ...this.state, ...value }; for (const listener of this.listeners) listener();
  }
}

export class LanClient {
  private static readonly maxQueryCache = 32;
  private state: Connection = { phase: 'login', message: '', loading: false };
  private readonly listeners = new Set<() => void>();
  private readonly queries = new Map<string, LanQuery<unknown>>();
  private readonly observedQueries = new Set<LanQuery<unknown>>();
  private abort: AbortController | null = null;
  private generation = 0;
  private serviceId: string | null = null;
  private pageId = randomId();
  private discussionId: string | null = null;
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private disposed = false;
  private queryAccess = 0;
  private activeReads = 0;
  private readonly waiting: (() => void)[] = [];

  getSnapshot = (): Connection => this.state;
  get online(): boolean { return this.state.phase === 'online'; }
  subscribe = (callback: () => void): (() => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; };
  query<T>(path: string, pagination: 'none' | 'forward' | 'history' = 'none'): LanQuery<T> {
    const key = `${pagination}:${path}`;
    let query = this.queries.get(key);
    if (!query) {
      this.evictQueryIfNeeded();
      query = new LanQuery(this, path, pagination); this.queries.set(key, query);
    }
    query.touch(++this.queryAccess);
    return query as LanQuery<T>;
  }
  observe(query: LanQuery<unknown>): void { this.observedQueries.add(query); }
  unobserve(query: LanQuery<unknown>): void { this.observedQueries.delete(query); }
  async login(code: string): Promise<void> {
    this.disposed = false;
    this.cancel(); this.update({ loading: true, message: '' });
    try {
      const result = await this.http<{ authenticated: boolean }>('/api/v1/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
      });
      this.serviceId = result.serviceId; this.pageId = randomId();
      this.update({ phase: 'connecting' }); this.resetQueries(); void this.connect();
    } catch (error) { this.update({ phase: 'login', message: messageOf(error) }); }
    finally { this.update({ loading: false }); }
  }
  async resume(): Promise<void> {
    this.disposed = false;
    try {
      const result = await this.http<{ authenticated: boolean }>('/api/v1/session');
      if (!this.disposed && result.data.authenticated) { this.serviceId = result.serviceId; void this.connect(); }
    } catch { if (!this.disposed) this.update({ message: '无法连接手机，请核对手机地址和 Wi-Fi' }); }
  }
  async logout(): Promise<void> {
    this.cancel(); this.serviceId = null;
    this.update({ phase: 'login', message: '', loading: false }); this.resetQueries();
    try { await this.http('/api/v1/session', { method: 'DELETE' }); }
    catch { this.update({ message: '本页已退出；手机连接恢复后可重新验证' }); }
  }
  setDiscussion(id: string | null): void {
    if (this.discussionId === id) return;
    this.discussionId = id;
    if (this.serviceId && !['login', 'ended', 'full'].includes(this.state.phase)) this.recalibrate();
  }
  recalibrate(): void {
    if (!this.serviceId || this.disposed || ['ended', 'full'].includes(this.state.phase)) return;
    this.cancel(); void this.connect();
  }
  networkLost(): void {
    if (!this.serviceId || ['ended', 'login'].includes(this.state.phase)) return;
    this.update({ phase: 'offline', message: '已断开，内容可能过期。网络恢复后会自动重新连接' });
    this.abort?.abort();
  }
  expired(message = '访问已失效，已有内容可能过期。请重新验证'): void {
    this.cancel(); this.update({ phase: 'ended', message, loading: false });
  }
  dispose(): void { this.disposed = true; this.cancel(); this.resetQueries(); }
  mediaUrl(id: string): string { return `/api/v1/media/${id}?pageId=${this.pageId}`; }

  async read<T>(path: string): Promise<T> {
    const generation = this.generation;
    if (this.activeReads >= 2) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.activeReads++;
    try {
      if (!this.online || generation !== this.generation) throw new Error('obsolete');
      const result = await this.http<T>(path, { headers: { 'X-Reader-Page-Id': this.pageId },
        ...(this.abort ? { signal: this.abort.signal } : {}) });
      if (generation !== this.generation) throw new Error('obsolete');
      if (result.serviceId !== this.serviceId) { this.expired(); throw new Error('obsolete'); }
      return result.data;
    } finally { this.activeReads--; this.waiting.shift()?.(); }
  }

  private async connect(): Promise<void> {
    if (this.disposed || !this.serviceId) return;
    const generation = ++this.generation;
    this.abort?.abort(); const abort = new AbortController(); this.abort = abort;
    let lastHeartbeat = performance.now(); let ready = false;
    const timer = setInterval(() => { if (performance.now() - lastHeartbeat >= 15_000) abort.abort(); }, 500);
    this.update({ phase: 'connecting', message: '' });
    try {
      const params = new URLSearchParams({ pageId: this.pageId });
      if (this.discussionId) params.set('discussionId', this.discussionId);
      const response = await fetch(`/api/v1/events?${params}`, { signal: abort.signal, cache: 'no-store' });
      if (!response.ok) throw await responseError(response);
      if (!response.body) throw new Error('No event stream');
      const parser = createParser({ onEvent: (event) => {
        if (generation !== this.generation) return;
        const data = JSON.parse(event.data) as LanEvent;
        if (data.serviceId !== this.serviceId || (data.protocolVersion !== undefined && data.protocolVersion !== READER_LAN_PROTOCOL_VERSION)) {
          this.expired('服务或页面版本已变化，请重新验证；版本不兼容时请重新加载页面'); return;
        }
        if (event.event === 'service-stopping') { this.expired('本次服务已结束，已有内容可能过期。请查看手机地址并重新验证'); return; }
        if (event.event === 'heartbeat') {
          lastHeartbeat = performance.now();
          if (!data.sourceReady) { this.networkLost(); return; }
        }
        if (event.event === 'ready') {
          lastHeartbeat = performance.now(); ready = true; this.retries = 0;
          this.update({ phase: 'online', message: '' }); this.invalidate();
        } else if (event.event === 'invalidate' && ready) this.invalidate();
        else if (ready && (event.event === 'reply-delta' || event.event === 'reply-state')) this.reply(data as unknown as LanReplyEvent);
      } });
      const reader = response.body.getReader(); const decoder = new TextDecoder();
      try {
        while (generation === this.generation) {
          const part = await reader.read(); if (part.done) break;
          parser.feed(decoder.decode(part.value, { stream: true }));
        }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      if (generation === this.generation) throw new Error('Connection ended');
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      if (error instanceof HttpError && error.status === 401) { this.expired(); return; }
      if (error instanceof HttpError && error.code === 'TOO_MANY_CLIENTS') {
        this.update({ phase: 'full', message: '连接已满，请关闭其他页面后重试' }); return;
      }
      this.update({ phase: 'offline', message: '已断开，内容可能过期。请核对手机当前地址和 Wi-Fi' });
      const delay = Math.min(15_000, 1000 * 2 ** this.retries++);
      this.reconnect = setTimeout(() => { void this.connect(); }, delay * (0.8 + Math.random() * 0.4));
    } finally { clearInterval(timer); }
  }

  private reply(event: LanReplyEvent): void {
    if (event.discussionId !== this.discussionId) return;
    const query = this.query<readonly LanLiveReply[]>(`/api/v1/live-replies?discussionId=${event.discussionId}`);
    const rows = query.getSnapshot().data;
    const old = rows?.find((row) => row.messageId === event.messageId);
    if (event.state === 'completed' || event.state === 'failed') {
      if (!old || old.generationId === event.generationId) query.apply((items) => items?.filter((item) => item.messageId !== event.messageId) ?? null);
      this.invalidate(); return;
    }
    if (!old || old.generationId !== event.generationId) { query.apply(() => null); query.invalidate(); return; }
    if (event.version <= old.version) return;
    if (event.type === 'reply-delta' && event.offset !== old.text.length) { query.invalidate(); return; }
    query.apply((items) => items?.map((row) => row.messageId !== event.messageId ? row : {
      ...row, version: event.version, text: event.previewAvailable === false ? '' : row.text + (event.delta ?? ''),
      previewAvailable: event.previewAvailable ?? row.previewAvailable,
      state: event.state === 'committing' ? 'committing' : row.state,
    }) ?? null);
    // A concurrent snapshot must not overwrite this newer prefix.
    if (query.getSnapshot().loading) query.invalidate();
  }
  private evictQueryIfNeeded(): void {
    if (this.queries.size < LanClient.maxQueryCache) return;
    const inactive = [...this.queries].filter(([, query]) => !query.observed);
    const candidates = inactive.length > 0 ? inactive : [...this.queries];
    const victim = candidates.sort(([, left], [, right]) => left.lastAccessed - right.lastAccessed)[0];
    if (!victim) return;
    if (!victim[1].observed) victim[1].reset();
    this.queries.delete(victim[0]);
  }
  private invalidate(): void {
    const queries = new Set([...this.queries.values(), ...this.observedQueries]);
    for (const query of queries) if (query.observed) query.invalidate();
  }
  private resetQueries(): void {
    const queries = new Set([...this.queries.values(), ...this.observedQueries]);
    for (const query of queries) query.reset();
  }
  private async http<T>(path: string, options: RequestInit = {}): Promise<LanEnvelope<T>> {
    const response = await fetch(path, { ...options, cache: 'no-store' });
    if (!response.ok) throw await responseError(response);
    if (response.status === 204) {
      return {
        protocolVersion: READER_LAN_PROTOCOL_VERSION,
        serviceId: this.serviceId ?? '',
        data: undefined as T,
      };
    }
    const data = await response.json() as LanEnvelope<T>;
    if (data.protocolVersion !== READER_LAN_PROTOCOL_VERSION) throw new HttpError(409, 'PROTOCOL_MISMATCH');
    return data;
  }
  private cancel(): void {
    this.generation++; this.abort?.abort(); this.abort = null;
    if (this.reconnect !== null) clearTimeout(this.reconnect); this.reconnect = null;
  }
  private update(value: Partial<Connection>): void {
    this.state = { ...this.state, ...value }; for (const listener of this.listeners) listener();
  }
}

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function responseError(response: Response): Promise<HttpError> {
  const value = await response.json().catch(() => null) as { error?: { code?: string } } | null;
  return new HttpError(response.status, value?.error?.code ?? 'DATA_UNAVAILABLE');
}
function messageOf(error: unknown): string {
  if (error instanceof HttpError && error.code === 'INVALID_CODE') return '访问码不正确，请核对手机';
  if (error instanceof HttpError && error.status === 429) return '验证过于频繁，请等待一分钟后重试';
  if (error instanceof HttpError && error.code === 'PROTOCOL_MISMATCH') return '页面版本不兼容，请重新加载';
  return '无法连接手机，请核对当前地址、Wi-Fi 和设备隔离设置';
}
