import { describe, expect, it, vi } from 'vitest';
import { AiSettingsStore, type AiConfigurationInput } from '@/core/ai/ai-settings-core';
import type { LocalDatabase } from '@/core/data/database-contract';
import { ReaderRuntime } from '@/core/runtime/runtime';

const input: AiConfigurationInput = {
  id: 'primary', name: '服务', provider: 'custom', protocol: 'chat-completions',
  baseUrl: 'https://ai.example.test/v1', apiKey: 'secret', model: 'test-model',
};

function fixture() {
  const values = new Map<string, string>();
  const settings = new AiSettingsStore({
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
    removeItem: async (key) => { values.delete(key); },
  });
  const database = {
    initialize: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
  } as unknown as LocalDatabase;
  const createDatabase = vi.fn(() => database);
  const generate = vi.fn(async () => ({ text: 'OK' }));
  const createAi = vi.fn(() => ({ generate }));
  return { runtime: new ReaderRuntime(createDatabase, settings, createAi), database, createDatabase, createAi, generate, settings };
}

describe('standalone application runtime', () => {
  it('opens its database once, keeps manual use independent from AI, and makes no startup request', async () => {
    const { runtime, createDatabase, generate } = fixture();
    await Promise.all([runtime.start(), runtime.start()]);
    runtime.retryData();
    expect(createDatabase).toHaveBeenCalledTimes(1);
    expect(runtime.getSnapshot()).toMatchObject({ dataPhase: 'ready', ai: null, aiServices: [] });
    expect(generate).not.toHaveBeenCalled();
  });

  it('closes a failed connection and supports a safe retry', async () => {
    const { runtime, database, createDatabase } = fixture();
    vi.mocked(database.initialize).mockRejectedValueOnce(new Error('disk unavailable'));
    await runtime.start();
    expect(runtime.getSnapshot()).toMatchObject({ database: null, dataPhase: 'error' });
    expect(database.close).toHaveBeenCalledTimes(1);
    runtime.retryData();
    await vi.waitFor(() => expect(runtime.getSnapshot().dataPhase).toBe('ready'));
    expect(createDatabase).toHaveBeenCalledTimes(2);
  });

  it('activates the saved service without exposing its key and clears it when removed', async () => {
    const { runtime, generate } = fixture();
    await expect(runtime.saveAiService(input)).resolves.toBe(true);
    expect(runtime.getSnapshot().defaultAiServiceId).toBe('primary');
    expect(runtime.getSnapshot().aiServices[0]).not.toHaveProperty('apiKey');
    expect(generate).not.toHaveBeenCalled();
    await expect(runtime.removeAiService('primary')).resolves.toBe(true);
    expect(runtime.getSnapshot()).toMatchObject({ ai: null, aiServices: [], defaultAiServiceId: null });
  });

  it('tests an unsaved draft only on request, without saving it or changing the current service', async () => {
    const { runtime, settings, generate } = fixture();
    await runtime.start();
    await expect(runtime.testAiService(input)).resolves.toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    await expect(settings.load()).resolves.toEqual({ services: [], defaultServiceId: null });
    expect(runtime.getSnapshot().ai).toBeNull();
  });

  it('reports request failure and allows retry without silently switching providers', async () => {
    const { runtime, generate } = fixture();
    await runtime.saveAiService(input);
    generate.mockRejectedValueOnce(new Error('service unavailable'));
    await expect(runtime.testAiService(input)).resolves.toBe(false);
    expect(runtime.getSnapshot()).toMatchObject({ aiError: 'service unavailable', actionPending: false, defaultAiServiceId: 'primary' });
    await expect(runtime.testAiService(input)).resolves.toBe(true);
    expect(runtime.getSnapshot().aiError).toBeNull();
  });
});
