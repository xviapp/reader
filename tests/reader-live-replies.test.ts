import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReaderLiveReplies } from '@/modules/reader/application/reader-live-replies';

afterEach(() => vi.useRealTimers());
describe('bounded live reply previews', () => {
  it('keeps prefixes before LAN starts, batches deltas at UTF-16 offsets, and ends only after committing', async () => {
    vi.useFakeTimers();
    const store = new ReaderLiveReplies(); const generation = store.start('discussion', 'message');
    store.append('message', generation, '前缀😀');
    const events = vi.fn(); const stop = store.subscribe(events);
    expect(store.snapshot('discussion', ['message'])[0]?.text).toBe('前缀😀');
    store.append('message', generation, '第一'); store.append('message', generation, '第二');
    expect(events).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(events).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'reply-delta', delta: '第一第二', offset: 4, version: 3 }));
    store.committing('message', generation);
    expect(store.snapshot('discussion', ['message'])[0]?.state).toBe('committing');
    store.finish('message', generation, 'completed');
    expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'completed' }));
    stop(); expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects callbacks and terminal events from an earlier retry', () => {
    const store = new ReaderLiveReplies(); const previous = store.start('d', 'm');
    store.append('m', previous, '旧内容'); const current = store.start('d', 'm');
    store.append('m', previous, '迟到'); store.finish('m', previous, 'completed');
    store.append('m', current, '新内容');
    expect(store.snapshot('d', ['m'])[0]).toMatchObject({ generationId: current, text: '新内容', state: 'generating' });
    expect(store.snapshot('hidden-discussion', ['m'])[0]).toMatchObject({ generationId: null, text: '', previewAvailable: false });
  });
  it('falls back without keeping a truncated prefix when per-answer, total or entry budgets are exceeded', () => {
    const store = new ReaderLiveReplies();
    for (let index = 0; index < 8; index++) {
      const generation = store.start('d', String(index));
      store.append(String(index), generation, '字'.repeat(1024 * 1024));
    }
    const ninth = store.start('d', 'ninth'); store.append('ninth', ninth, 'hidden');
    const rows = store.snapshot('d', ['0', '1', '2', '3', '4', 'ninth']);
    expect(rows.slice(0, 4).every((row) => row.text.length === 1024 * 1024)).toBe(true);
    expect(rows.slice(4).every((row) => !row.previewAvailable && row.text === '')).toBe(true);
    const retry = store.start('d', '0'); store.append('0', retry, '字'.repeat(1024 * 1024 + 1));
    expect(store.snapshot('d', ['0'])[0]).toMatchObject({ text: '', previewAvailable: false });
    store.finish('1', rows[1]!.generationId!, 'completed');
    const admitted = store.start('d', 'new'); store.append('new', admitted, '可以继续');
    expect(store.snapshot('d', ['new'])[0]?.text).toBe('可以继续');
  });
  it('keeps generation healthy when a transport subscriber throws', () => {
    const store = new ReaderLiveReplies(); const stop = store.subscribe(() => { throw new Error('transport gone'); });
    expect(() => { const generation = store.start('d', 'm'); store.append('m', generation, '内容'); store.finish('m', generation, 'failed'); }).not.toThrow();
    stop();
  });
});
