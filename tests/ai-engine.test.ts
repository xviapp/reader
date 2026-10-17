import { describe, expect, it, vi } from 'vitest';

import type { AiResponseStateStore } from '@/core/ai/ai-response-state';
import { DirectAiAdapter } from '@/core/ai/direct-ai-adapter';

const baseConfiguration = {
  id: 'service-1',
  name: 'Service',
  provider: 'custom' as const,
  protocol: 'chat-completions' as const,
  baseUrl: 'https://ai.example.test/v1',
  apiKey: 'local-secret',
  model: 'model-a',
};

describe('direct AI adapter', () => {
  it('streams Chat Completions text and ignores reasoning fields', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => sseResponse([
      { id: 'chat-1', choices: [{ delta: { reasoning_content: 'hidden', content: '你' } }] },
      { id: 'chat-1', choices: [{ delta: { content: '好' } }] },
      '[DONE]',
    ]));
    const engine = new DirectAiAdapter({ ...baseConfiguration, fetch: fetchImplementation });
    const deltas: string[] = [];

    await expect(engine.generate({ messages: [{ role: 'user', content: 'hello' }] }, {
      onDelta: (delta) => deltas.push(delta),
    })).resolves.toEqual({ text: '你好' });

    expect(deltas).toEqual(['你', '好']);
    const body = requestBody(fetchImplementation);
    expect(body).toMatchObject({ model: 'model-a', stream: true });
    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://ai.example.test/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer local-secret' }),
      }),
    );
  });

  it('buffers structured JSON without publishing partial deltas', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json({
      choices: [{ message: { content: '{"summary":"摘要"}' } }],
    }));
    const engine = new DirectAiAdapter({
      ...baseConfiguration,
      fetch: fetchImplementation,
    });
    const onDelta = vi.fn();
    await expect(engine.generate({
      responseFormat: 'json', messages: [{ role: 'user', content: '整理' }],
    }, { onDelta })).resolves.toEqual({ text: '{"summary":"摘要"}' });
    expect(onDelta).not.toHaveBeenCalled();
    expect(requestBody(fetchImplementation)).toMatchObject({
      response_format: { type: 'json_object' },
      stream: false,
    });
  });

  it('buffers structured JSON for Responses', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json({
      id: 'response-json-1', output_text: '{"text":"整理后的原文"}',
    }));
    const engine = new DirectAiAdapter({
      ...baseConfiguration,
      protocol: 'responses',
      fetch: fetchImplementation,
    });
    const onDelta = vi.fn();

    await expect(engine.generate({
      responseFormat: 'json', messages: [{ role: 'user', content: '整理' }],
    }, { onDelta })).resolves.toEqual({ text: '{"text":"整理后的原文"}' });

    expect(onDelta).not.toHaveBeenCalled();
    expect(requestBody(fetchImplementation)).toMatchObject({
      stream: false,
      text: { format: { type: 'json_object' } },
    });
  });

  it('sends a strict JSON Schema and falls back to plain JSON mode once a service rejects it', async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: { message: 'response_format json_schema is unavailable' } }, { status: 400 }))
      .mockImplementation(async () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }));
    const engine = new DirectAiAdapter({ ...baseConfiguration, fetch: fetchImplementation });
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
    const request = { responseFormat: 'json' as const, responseSchema: { name: 'result', schema }, messages: [{ role: 'user' as const, content: '整理' }] };

    await expect(engine.generate(request)).resolves.toEqual({ text: '{"ok":true}' });
    await engine.generate(request);

    const bodies = fetchImplementation.mock.calls.map(call => JSON.parse(String(call[1]?.body)) as Record<string, unknown>);
    expect(bodies[0]).toMatchObject({ response_format: { type: 'json_schema', json_schema: { name: 'result', schema, strict: true } } });
    expect(bodies.slice(1).map(body => body.response_format)).toEqual([{ type: 'json_object' }, { type: 'json_object' }]);
  });

  it('sends JSON Schema in the Responses text format', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json({ id: 'response-schema-1', output_text: '{"ok":true}' }));
    const engine = new DirectAiAdapter({ ...baseConfiguration, protocol: 'responses', fetch: fetchImplementation });
    await engine.generate({ responseFormat: 'json', responseSchema: { name: 'result', schema: { type: 'object' } }, messages: [{ role: 'user', content: '整理' }] });
    expect(requestBody(fetchImplementation)).toMatchObject({ text: { format: { type: 'json_schema', name: 'result', schema: { type: 'object' }, strict: true } } });
  });

  it.each([[401, 'invalid-credential'], [429, 'rate-limited']] as const)('does not retry HTTP %s failures without the schema', async (status, code) => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json({}, { status }));
    const engine = new DirectAiAdapter({ ...baseConfiguration, fetch: fetchImplementation });
    await expect(engine.generate({ responseFormat: 'json', responseSchema: { name: 'result', schema: {} }, messages: [{ role: 'user', content: '整理' }] }))
      .rejects.toMatchObject({ code });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('sends the full transcript for Responses conversations', async () => {
    const state = memoryResponseState();
    const fetchImplementation = vi.fn<typeof fetch>(async () => sseResponse([
      { type: 'response.created', response: { id: 'response-2' } },
      { type: 'response.output_text.delta', delta: '完成' },
      { type: 'response.completed', response: { id: 'response-2', output_text: '完成' } },
    ]));
    await state.set('service-1', 'assistant', 'response-1');
    const engine = new DirectAiAdapter({
      ...baseConfiguration,
      protocol: 'responses',
      responseState: state,
      fetch: fetchImplementation,
    });

    await expect(engine.generate({
      conversationId: 'assistant',
      messages: [
        { role: 'system', content: '固定指令' },
        { role: 'user', content: '旧问题' },
        { role: 'assistant', content: '旧回答' },
        { role: 'user', content: '新问题' },
      ],
    })).resolves.toEqual({ text: '完成' });
    const body = requestBody(fetchImplementation);
    expect(body).toMatchObject({
      instructions: '固定指令',
      input: [
        { role: 'user', content: '旧问题' },
        { role: 'assistant', content: '旧回答' },
        { role: 'user', content: '新问题' },
      ],
      stream: true,
    });
    expect(body).not.toHaveProperty('previous_response_id');
    await expect(state.get('service-1', 'assistant')).resolves.toBe('response-2');
  });

  it('ignores stale Responses state and always sends the complete transcript', async () => {
    const state = memoryResponseState();
    await state.set('service-1', 'assistant', 'expired');
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json(
      { id: 'fresh', output_text: '重新建立' },
    ));
    const engine = new DirectAiAdapter({
      ...baseConfiguration, protocol: 'responses', responseState: state, fetch: fetchImplementation,
    });
    await expect(engine.generate({
      conversationId: 'assistant',
      messages: [{ role: 'user', content: '第一条' }, { role: 'assistant', content: '回答' }, { role: 'user', content: '继续' }],
    })).resolves.toEqual({ text: '重新建立' });
    const body = JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('previous_response_id');
    expect(body.input).toHaveLength(3);
  });

  it('renders message images as multimodal parts for chat completions', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json({
      choices: [{ message: { content: '看到了' } }],
    }));
    const engine = new DirectAiAdapter({ ...baseConfiguration, fetch: fetchImplementation });

    await engine.generate({
      messages: [{ role: 'user', content: '这是什么？', images: ['data:image/jpeg;base64,AAAA'] }],
    });

    const body = JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: '这是什么？' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
      ],
    }]);
  });

  it('renders message images as multimodal parts for Responses input', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json({ id: 'r1', output_text: '看到了' }));
    const engine = new DirectAiAdapter({ ...baseConfiguration, protocol: 'responses', fetch: fetchImplementation });

    await engine.generate({
      messages: [
        { role: 'system', content: '指令' },
        { role: 'user', content: '这是什么？', images: ['data:image/png;base64,BBBB'] },
      ],
    });

    const body = JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.input).toEqual([{
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: '这是什么？' },
        { type: 'input_image', image_url: 'data:image/png;base64,BBBB' },
      ],
    }]);
  });

  it('omits authorization for an unauthenticated custom endpoint', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json({
      choices: [{ message: { content: 'ok' } }],
    }));
    const engine = new DirectAiAdapter({ ...baseConfiguration, apiKey: '', fetch: fetchImplementation });
    await engine.generate({ messages: [{ role: 'user', content: 'hello' }] });
    expect(fetchImplementation.mock.calls[0]?.[1]?.headers).not.toHaveProperty('authorization');
  });

  it('maps provider authorization failures without returning response internals', async () => {
    const engine = new DirectAiAdapter({
      ...baseConfiguration,
      apiKey: 'bad',
      fetch: async () => Response.json({ error: { message: 'upstream detail' } }, { status: 401 }),
    });
    await expect(engine.generate({ messages: [{ role: 'user', content: 'hello' }] }))
      .rejects.toMatchObject({ code: 'invalid-credential', message: 'AI 凭据无效' });
  });

  it('keeps the timeout active while reading the response body', async () => {
    const engine = new DirectAiAdapter({
      ...baseConfiguration,
      timeoutMs: 5,
      fetch: async (_input, init) => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => new Promise<string>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
      }) as Response,
    });
    await expect(engine.generate({ messages: [{ role: 'user', content: 'hello' }] }))
      .rejects.toMatchObject({ code: 'timeout', message: 'AI 请求超时，请稍后重试' });
  });
});

function sseResponse(events: readonly (Record<string, unknown> | string)[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        const data = typeof event === 'string' ? event : JSON.stringify(event);
        const midpoint = Math.max(1, Math.floor(data.length / 2));
        controller.enqueue(encoder.encode(`data: ${data.slice(0, midpoint)}`));
        controller.enqueue(encoder.encode(`${data.slice(midpoint)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
}

function requestBody(fetchImplementation: ReturnType<typeof vi.fn<typeof fetch>>): Record<string, unknown> {
  return JSON.parse(String(fetchImplementation.mock.calls.at(-1)?.[1]?.body)) as Record<string, unknown>;
}

function memoryResponseState(): AiResponseStateStore {
  const values = new Map<string, string>();
  const key = (serviceId: string, conversationId: string) => `${serviceId}:${conversationId}`;
  return {
    get: async (serviceId, conversationId) => values.get(key(serviceId, conversationId)) ?? null,
    set: async (serviceId, conversationId, responseId) => { values.set(key(serviceId, conversationId), responseId); },
    remove: async (serviceId, conversationId) => { values.delete(key(serviceId, conversationId)); },
    removeConversation: async (conversationId) => {
      for (const entry of values.keys()) if (entry.endsWith(`:${conversationId}`)) values.delete(entry);
    },
    removeService: async (serviceId) => {
      for (const entry of values.keys()) if (entry.startsWith(`${serviceId}:`)) values.delete(entry);
    },
    clear: async () => { values.clear(); },
  };
}
