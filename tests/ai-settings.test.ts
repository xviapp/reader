import { describe, expect, it } from 'vitest';

import { AiSettingsStore } from '@/core/ai/ai-settings-core';

function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const store = new AiSettingsStore({
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
    removeItem: async (key) => { values.delete(key); },
  });
  return { store, values };
}

describe('AI settings store', () => {
  it('persists multiple named services and maintains exactly one default', async () => {
    const { store } = memoryStore();
    await store.upsert({
      id: 'openai-1', name: 'OpenAI', provider: 'openai', protocol: 'responses',
      baseUrl: ' https://api.openai.com/v1/ ', apiKey: ' secret-a ', model: ' gpt-4.1-mini ',
    });
    await store.upsert({
      id: 'deepseek-1', name: 'DeepSeek', provider: 'deepseek', protocol: 'chat-completions',
      baseUrl: 'https://api.deepseek.com', apiKey: 'secret-b', model: 'deepseek-chat',
    });
    await store.setDefault('deepseek-1');

    await expect(store.load()).resolves.toMatchObject({
      defaultServiceId: 'deepseek-1',
      services: [
        { id: 'openai-1', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: 'secret-a' },
        { id: 'deepseek-1', name: 'DeepSeek', apiKey: 'secret-b' },
      ],
    });
    await expect(store.remove('deepseek-1')).rejects.toThrow('另一个默认');
    await store.setDefault('openai-1');
    await expect(store.remove('deepseek-1')).resolves.toMatchObject({
      defaultServiceId: 'openai-1', services: [{ id: 'openai-1' }],
    });
  });

  it('keeps an existing key when an edited service leaves the key blank', async () => {
    const { store } = memoryStore();
    await store.upsert({
      id: 'service-1', name: 'Main', provider: 'openai', protocol: 'responses',
      baseUrl: 'https://api.openai.com/v1', apiKey: 'original-key', model: 'gpt-4.1-mini',
    });
    await store.upsert({
      id: 'service-1', name: 'Primary', provider: 'openai', protocol: 'responses',
      baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4.1',
    });
    await expect(store.load()).resolves.toMatchObject({
      services: [{ id: 'service-1', name: 'Primary', apiKey: 'original-key', model: 'gpt-4.1' }],
    });
  });

  it('allows an unauthenticated custom service and rejects duplicate names', async () => {
    const { store } = memoryStore();
    await store.upsert({
      id: 'local-1', name: 'Local', provider: 'custom', protocol: 'chat-completions',
      baseUrl: 'http://192.168.1.10:11434/v1', apiKey: '', model: 'qwen',
    });
    await expect(store.upsert({
      id: 'local-2', name: 'local', provider: 'custom', protocol: 'responses',
      baseUrl: 'http://127.0.0.1:8000/v1', apiKey: '', model: 'test',
    })).rejects.toThrow('名称不能重复');
  });

  it('starts empty and only reads its own settings key', async () => {
    const { store, values } = memoryStore({ 'unrelated.preferences': 'leave unchanged' });
    await expect(store.load()).resolves.toEqual({ services: [], defaultServiceId: null });
    await store.clear();
    expect([...values.entries()]).toEqual([['unrelated.preferences', 'leave unchanged']]);
  });
});
