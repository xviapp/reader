export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

interface ResponseStateDocument {
  values: Record<string, string>;
}

export interface AiResponseStateStore {
  get(serviceId: string, conversationId: string): Promise<string | null>;
  set(serviceId: string, conversationId: string, responseId: string): Promise<void>;
  remove(serviceId: string, conversationId: string): Promise<void>;
  removeConversation(conversationId: string): Promise<void>;
  removeService(serviceId: string): Promise<void>;
  clear(): Promise<void>;
}

export interface AiResponseStateOptions {
  storage: KeyValueStorage;
  key: string;
}

class LocalAiResponseStateStore implements AiResponseStateStore {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: AiResponseStateOptions) {}

  async get(serviceId: string, conversationId: string): Promise<string | null> {
    await this.tail;
    const document = await this.read();
    return document.values[stateKey(serviceId, conversationId)] ?? null;
  }

  set(serviceId: string, conversationId: string, responseId: string): Promise<void> {
    return this.mutate((document) => {
      document.values[stateKey(serviceId, conversationId)] = responseId;
    });
  }

  remove(serviceId: string, conversationId: string): Promise<void> {
    return this.mutate((document) => {
      delete document.values[stateKey(serviceId, conversationId)];
    });
  }

  removeConversation(conversationId: string): Promise<void> {
    const suffix = `\u0000${conversationId}`;
    return this.mutate((document) => {
      for (const key of Object.keys(document.values)) {
        if (key.endsWith(suffix)) delete document.values[key];
      }
    });
  }

  removeService(serviceId: string): Promise<void> {
    const prefix = `${serviceId}\u0000`;
    return this.mutate((document) => {
      for (const key of Object.keys(document.values)) {
        if (key.startsWith(prefix)) delete document.values[key];
      }
    });
  }

  clear(): Promise<void> {
    this.tail = this.tail.then(() => this.options.storage.removeItem(this.options.key));
    return this.tail;
  }

  private mutate(action: (document: ResponseStateDocument) => void): Promise<void> {
    this.tail = this.tail.then(async () => {
      const document = await this.read();
      action(document);
      await this.options.storage.setItem(this.options.key, JSON.stringify(document));
    });
    return this.tail;
  }

  private async read(): Promise<ResponseStateDocument> {
    const raw = await this.options.storage.getItem(this.options.key);
    if (!raw) return { values: {} };
    try {
      const value = JSON.parse(raw) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { values: {} };
      const values = (value as Record<string, unknown>).values;
      if (!values || typeof values !== 'object' || Array.isArray(values)) return { values: {} };
      const clean: Record<string, string> = {};
      for (const [key, entry] of Object.entries(values)) {
        if (typeof entry === 'string') clean[key] = entry;
      }
      return { values: clean };
    } catch {
      return { values: {} };
    }
  }
}

export function createAiResponseStateStore(options: AiResponseStateOptions): AiResponseStateStore {
  return new LocalAiResponseStateStore(options);
}

function stateKey(serviceId: string, conversationId: string): string {
  return `${serviceId}\u0000${conversationId}`;
}
