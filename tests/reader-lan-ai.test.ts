import { describe, expect, it, vi } from 'vitest';
import type { AiEngine } from '@/core/ai/ai-engine';
import { ReaderAiCoordinator } from '@/modules/reader/application/reader-ai';
import { ReaderLiveReplies } from '@/modules/reader/application/reader-live-replies';
import type { ReaderRepository } from '@/modules/reader/application/ports';
import type { ReaderDiscussion, ReaderPrompt } from '@/modules/reader/domain/model';
import { DEFAULT_READER_PROMPTS } from '@/modules/reader/domain/defaults';

describe('AI preview integration with the existing save path', () => {
  it('ignores old retries and only publishes completion after the database save resolves', async () => {
    const calls: { options: Parameters<AiEngine['generate']>[1]; resolve(value: { text: string }): void }[] = [];
    let save!: () => void;
    const repository = {
      prepareMessageRetry: vi.fn(async () => undefined),
      completeMessage: vi.fn(() => new Promise<void>((resolve) => { save = resolve; })),
      failMessage: vi.fn(async () => undefined),
    } as unknown as ReaderRepository;
    const generate = vi.fn<AiEngine['generate']>((_request, options) => new Promise((resolve) => calls.push({ options, resolve })));
    const live = new ReaderLiveReplies(); const events = vi.fn(); const stop = live.subscribe(events);
    const coordinator = new ReaderAiCoordinator(repository, () => ({ generate }), null, () => null, live);
    const retry = () => coordinator.retryReply({ id: 'd' } as ReaderDiscussion, 'm', '问题', { book: null, passage: null, role: null },
      { id: 'prompt', stage: 'follow-up', ...DEFAULT_READER_PROMPTS['follow-up'], createdAt: '', updatedAt: '' } satisfies ReaderPrompt, []);
    const first = retry(); await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0]!.options?.onDelta?.('第一轮');
    coordinator.stop('discussion:d');
    calls[0]!.options?.onDelta?.('停止后的回调');
    expect(live.snapshot('d', ['m'])[0]?.text).toBe('第一轮');
    const second = retry(); await vi.waitFor(() => expect(calls).toHaveLength(2));
    calls[1]!.options?.onDelta?.('新回答');
    calls[0]!.options?.onDelta?.('迟到的文本'); calls[0]!.resolve({ text: '旧的最终值' }); await first;
    expect(live.snapshot('d', ['m'])[0]?.text).toBe('新回答');
    expect(repository.completeMessage).not.toHaveBeenCalled();
    calls[1]!.resolve({ text: '新回答的完整保存值' });
    await vi.waitFor(() => expect(repository.completeMessage).toHaveBeenCalledWith('m', '新回答的完整保存值'));
    expect(live.snapshot('d', ['m'])[0]?.state).toBe('committing');
    expect(events.mock.calls.some(([event]) => event.state === 'completed')).toBe(false);
    save(); await second;
    expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'completed' }));
    expect(live.snapshot('d', ['m'])[0]?.previewAvailable).toBe(false);
    expect(generate).toHaveBeenCalledTimes(2); expect(repository.failMessage).not.toHaveBeenCalled(); stop();
  });
});
