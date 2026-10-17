type AiMessageRole = 'system' | 'user' | 'assistant';

export interface AiMessage {
  role: AiMessageRole;
  content: string;
  /** Image attachments: http(s) URLs or data: URLs. Rendered as multimodal content parts when present. */
  images?: readonly string[];
}

export interface AiResponseSchema {
  name: string;
  /** Strict JSON Schema: every property required, optional values nullable, no additional properties. */
  schema: Record<string, unknown>;
}

export interface AiGenerationRequest {
  messages: readonly AiMessage[];
  responseFormat?: 'text' | 'json';
  /** Constrains `responseFormat: 'json'`; services that reject schemas fall back to plain JSON mode. */
  responseSchema?: AiResponseSchema;
  temperature?: number;
  /** Stable local identity used only by stateful Responses conversations. */
  conversationId?: string;
}

export interface AiGenerationOptions {
  signal?: AbortSignal;
  onDelta?(text: string): void;
}

export interface AiGenerationResult {
  text: string;
}

export interface AiEngine {
  generate(
    request: AiGenerationRequest,
    options?: AiGenerationOptions,
  ): Promise<AiGenerationResult>;
  clearConversation?(conversationId: string): Promise<void>;
}

export class AiEngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'AiEngineError';
  }
}
