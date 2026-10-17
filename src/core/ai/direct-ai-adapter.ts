import {
  AiEngineError,
  type AiEngine,
  type AiGenerationOptions,
  type AiGenerationRequest,
  type AiGenerationResult,
  type AiMessage,
  type AiResponseSchema,
} from './ai-engine.js';
import type { AiConfiguration } from './ai-settings-core.js';

/**
 * The direct adapter only needs this small persistence seam. Keeping the
 * structural type here lets lightweight apps opt out of response-state
 * persistence without pulling the queue-specific module into their bundle.
 */
interface AiResponseStateStore {
  set(serviceId: string, conversationId: string, responseId: string): Promise<void>;
  remove(serviceId: string, conversationId: string): Promise<void>;
}

interface DirectAiAdapterOptions extends AiConfiguration {
  fetch?: typeof fetch;
  timeoutMs?: number;
  responseState?: AiResponseStateStore;
}

interface ParsedResponse {
  text: string;
  responseId: string | null;
}

function abortError(): Error {
  const error = new Error('AI 请求已取消');
  error.name = 'AbortError';
  return error;
}

export class DirectAiAdapter implements AiEngine {
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;
  private readonly responseState: AiResponseStateStore | null;
  /** Set once a service rejects JSON Schema output; later requests use plain JSON mode directly. */
  private schemaRejected = false;

  constructor(private readonly configuration: DirectAiAdapterOptions) {
    this.fetchImplementation = configuration.fetch ?? fetch;
    this.timeoutMs = configuration.timeoutMs ?? 60_000;
    this.responseState = configuration.responseState ?? null;
  }

  async generate(
    request: AiGenerationRequest,
    options: AiGenerationOptions = {},
  ): Promise<AiGenerationResult> {
    const parsed = await this.request(request, options).catch((error: unknown) => {
      if (!this.schemaFor(request) || !(error instanceof AiEngineError) || error.code !== 'rejected') throw error;
      // Many compatible services only support json_object; retry once without the schema.
      this.schemaRejected = true;
      return this.request(request, options);
    });
    await this.saveResponseState(request.conversationId, parsed.responseId);
    return { text: parsed.text };
  }

  async clearConversation(conversationId: string): Promise<void> {
    await this.responseState?.remove(this.configuration.id, conversationId);
  }

  private async request(
    request: AiGenerationRequest,
    options: AiGenerationOptions,
  ): Promise<ParsedResponse> {
    if (options.signal?.aborted) throw abortError();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(this.endpoint(), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(this.requestBody(request)),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await responsePayload(response);
        throw providerError(response, payload);
      }
      const publishDelta = request.responseFormat === 'json' ? undefined : options.onDelta;
      const parsed = isEventStream(response)
        ? await readEventStream(response, this.configuration.protocol, publishDelta)
        : parseResponsePayload(await responsePayload(response), this.configuration.protocol);
      const text = parsed.text.trim();
      if (!text) throw new AiEngineError('invalid-response', 'AI 服务没有返回内容');
      if (!isEventStream(response)) publishDelta?.(text);
      return { ...parsed, text };
    } catch (error) {
      if (options.signal?.aborted) throw abortError();
      if (controller.signal.aborted) {
        throw new AiEngineError('timeout', 'AI 请求超时，请稍后重试');
      }
      if (error instanceof AiEngineError) throw error;
      throw new AiEngineError('unavailable', '无法连接 AI 服务');
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', cancel);
    }
  }

  private endpoint(): string {
    const path = this.configuration.protocol === 'responses' ? 'responses' : 'chat/completions';
    return `${this.configuration.baseUrl.replace(/\/$/, '')}/${path}`;
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(this.configuration.apiKey
        ? { authorization: `Bearer ${this.configuration.apiKey}` }
        : {}),
    };
  }

  private schemaFor(request: AiGenerationRequest): AiResponseSchema | undefined {
    return request.responseFormat === 'json' && !this.schemaRejected ? request.responseSchema : undefined;
  }

  private requestBody(request: AiGenerationRequest): Record<string, unknown> {
    const schema = this.schemaFor(request);
    const temperature = Math.max(0, Math.min(2, request.temperature ?? 0.4));
    const stream = request.responseFormat !== 'json';
    if (this.configuration.protocol === 'chat-completions') {
      return {
        model: this.configuration.model,
        messages: request.messages.map(chatCompletionsMessage),
        temperature,
        stream,
        ...(request.responseFormat === 'json'
          ? { response_format: schema
            ? { type: 'json_schema', json_schema: { name: schema.name, schema: schema.schema, strict: true } }
            : { type: 'json_object' } }
          : {}),
      };
    }
    const instructions = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const conversational = request.messages.filter((message) => message.role !== 'system');
    return {
      model: this.configuration.model,
      // Always send the full transcript so conversation context survives even
      // when the provider ignores server-side conversation state.
      input: conversational.map(responseInputMessage),
      instructions: instructions || undefined,
      temperature,
      stream,
      ...(request.responseFormat === 'json'
        ? { text: { format: schema
          ? { type: 'json_schema', name: schema.name, schema: schema.schema, strict: true }
          : { type: 'json_object' } } }
        : {}),
    };
  }

  private async saveResponseState(conversationId: string | undefined, responseId: string | null): Promise<void> {
    if (!conversationId || !responseId || !this.responseState || this.configuration.protocol !== 'responses') return;
    await this.responseState.set(this.configuration.id, conversationId, responseId);
  }
}

function chatCompletionsMessage(message: AiMessage): Record<string, unknown> {
  return { role: message.role, content: contentParts(message, 'text', 'image_url') };
}

function responseInputMessage(message: AiMessage): Record<string, unknown> {
  return {
    type: 'message',
    role: message.role,
    content: contentParts(message, 'input_text', 'input_image'),
  };
}

function contentParts(message: AiMessage, textType: string, imageType: string): string | unknown[] {
  if (!message.images?.length) return message.content;
  return [
    ...(message.content.trim() ? [{ type: textType, text: message.content }] : []),
    ...message.images.map((url) => imageType === 'image_url'
      ? { type: 'image_url', image_url: { url } }
      : { type: 'input_image', image_url: url }),
  ];
}

async function responsePayload(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AiEngineError('invalid-response', 'AI 服务返回了无效数据');
  }
}

function isEventStream(response: Response): boolean {
  return response.headers.get('content-type')?.toLocaleLowerCase().includes('text/event-stream') ?? false;
}

async function readEventStream(
  response: Response,
  protocol: AiConfiguration['protocol'],
  onDelta?: (text: string) => void,
): Promise<ParsedResponse> {
  if (!response.body) {
    throw new AiEngineError('invalid-response', 'AI 服务没有返回可读取的数据流');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let responseId: string | null = null;
  const consume = (frame: string) => {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim();
    if (!data || data === '[DONE]') return;
    let payload: unknown;
    try {
      payload = JSON.parse(data) as unknown;
    } catch {
      throw new AiEngineError('invalid-response', 'AI 服务返回了无效流数据');
    }
    const parsed = protocol === 'responses'
      ? responseStreamEvent(payload)
      : chatStreamEvent(payload);
    if (parsed.responseId) responseId = parsed.responseId;
    if (parsed.delta) {
      text += parsed.delta;
      onDelta?.(parsed.delta);
    }
    if (!text && parsed.completedText) text = parsed.completedText;
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      consume(frame);
      boundary = buffer.indexOf('\n\n');
    }
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  return { text, responseId };
}

function chatStreamEvent(payload: unknown): { delta: string; responseId: string | null; completedText: string } {
  if (!isRecord(payload)) return { delta: '', responseId: null, completedText: '' };
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = isRecord(choices[0]) ? choices[0] : null;
  const delta = first && isRecord(first.delta) && typeof first.delta.content === 'string'
    ? first.delta.content
    : '';
  return {
    delta,
    responseId: typeof payload.id === 'string' ? payload.id : null,
    completedText: '',
  };
}

function responseStreamEvent(payload: unknown): { delta: string; responseId: string | null; completedText: string } {
  if (!isRecord(payload)) return { delta: '', responseId: null, completedText: '' };
  const type = typeof payload.type === 'string' ? payload.type : '';
  const delta = type === 'response.output_text.delta' && typeof payload.delta === 'string'
    ? payload.delta
    : '';
  const response = isRecord(payload.response) ? payload.response : null;
  return {
    delta,
    responseId: response && typeof response.id === 'string'
      ? response.id
      : typeof payload.response_id === 'string'
        ? payload.response_id
        : null,
    completedText: type === 'response.completed' && response
      ? responseText(response)
      : '',
  };
}

function parseResponsePayload(payload: unknown, protocol: AiConfiguration['protocol']): ParsedResponse {
  if (protocol === 'chat-completions') {
    if (!isRecord(payload)) return { text: '', responseId: null };
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = isRecord(choices[0]) ? choices[0] : null;
    const message = first && isRecord(first.message) ? first.message : null;
    return {
      text: message && typeof message.content === 'string' ? message.content : '',
      responseId: typeof payload.id === 'string' ? payload.id : null,
    };
  }
  if (!isRecord(payload)) return { text: '', responseId: null };
  return {
    text: responseText(payload),
    responseId: typeof payload.id === 'string' ? payload.id : null,
  };
}

function responseText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === 'string') return payload.output_text;
  if (!Array.isArray(payload.output)) return '';
  const parts: string[] = [];
  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isRecord(content)) continue;
      if (content.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('');
}

function providerError(response: Response, payload: unknown): AiEngineError {
  if (response.status === 401 || response.status === 403) {
    return new AiEngineError('invalid-credential', 'AI 凭据无效');
  }
  if (response.status === 429) {
    return new AiEngineError('rate-limited', 'AI 请求过于频繁，请稍后重试', retryAfterMs(response));
  }
  if (response.status >= 500) {
    return new AiEngineError('unavailable', 'AI 服务暂时不可用', retryAfterMs(response));
  }
  return new AiEngineError('rejected', providerErrorDetail(payload) || 'AI 服务拒绝了请求');
}

function providerErrorDetail(payload: unknown): string {
  if (!isRecord(payload) || !isRecord(payload.error)) return '';
  return typeof payload.error.message === 'string' ? payload.error.message.slice(0, 500) : '';
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get('retry-after')?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 15 * 60_000);
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return undefined;
  return Math.max(0, Math.min(at - Date.now(), 15 * 60_000));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
