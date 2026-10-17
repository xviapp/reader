export type AiProvider = 'openai' | 'deepseek' | 'custom';
export type AiProtocol = 'chat-completions' | 'responses';

export interface AiConfiguration {
  id: string;
  name: string;
  provider: AiProvider;
  protocol: AiProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AiConfigurationInput {
  id?: string;
  name: string;
  provider: AiProvider;
  protocol: AiProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AiSettingsSnapshot {
  services: readonly AiConfiguration[];
  defaultServiceId: string | null;
}

export interface AiSecretStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface AiSettingsKeys {
  current: string;
}

export interface AiSettingsStoreOptions {
  storage: AiSecretStorage;
  keys: AiSettingsKeys;
}

export const AI_PROVIDER_DEFAULTS: Readonly<Record<Exclude<AiProvider, 'custom'>, {
  baseUrl: string;
  model: string;
}>> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
};

const EMPTY_SETTINGS: AiSettingsSnapshot = { services: [], defaultServiceId: null };
const DEFAULT_SETTINGS_KEYS: AiSettingsKeys = { current: 'ai.services.v2' };

export function normalizeAiConfiguration(
  input: AiConfigurationInput,
  existingApiKey = '',
): AiConfiguration {
  const id = input.id?.trim() || createAiServiceId();
  const name = input.name.trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!name) throw new Error('请输入服务名称');
  if (!isProvider(input.provider)) throw new Error('请选择有效的 AI 服务商');
  if (!isProtocol(input.protocol)) throw new Error('请选择有效的请求协议');

  const rawUrl = input.baseUrl.trim();
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('请输入有效的 AI 服务地址');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('AI 服务地址必须使用 HTTP 或 HTTPS');
  }

  const apiKey = input.apiKey.trim() || existingApiKey;
  const model = input.model.trim();
  if (input.provider !== 'custom' && !apiKey) throw new Error('请输入 API Key');
  if (!model) throw new Error('请输入模型名称');
  return {
    id: id.slice(0, 160),
    name,
    provider: input.provider,
    protocol: input.protocol,
    baseUrl: url.toString().replace(/\/$/, ''),
    apiKey,
    model: model.slice(0, 160),
  };
}

export function publicAiConfiguration(configuration: AiConfiguration): Omit<AiConfiguration, 'apiKey'> {
  const { apiKey: _apiKey, ...publicConfiguration } = configuration;
  return publicConfiguration;
}

export class AiSettingsStore {
  constructor(
    private readonly storage: AiSecretStorage,
    private readonly keys: AiSettingsKeys = DEFAULT_SETTINGS_KEYS,
  ) {}

  async load(): Promise<AiSettingsSnapshot> {
    const current = settingsOf(await this.storage.getItem(this.keys.current));
    return current ?? EMPTY_SETTINGS;
  }

  async upsert(input: AiConfigurationInput): Promise<AiSettingsSnapshot> {
    const current = await this.load();
    const existing = input.id
      ? current.services.find((service) => service.id === input.id) ?? null
      : null;
    const nextService = normalizeAiConfiguration(input, existing?.apiKey);
    const duplicate = current.services.find((service) => (
      service.id !== nextService.id
      && service.name.localeCompare(nextService.name, undefined, { sensitivity: 'accent' }) === 0
    ));
    if (duplicate) throw new Error('AI 服务名称不能重复');

    const services = existing
      ? current.services.map((service) => service.id === nextService.id ? nextService : service)
      : [...current.services, nextService];
    const next: AiSettingsSnapshot = {
      services,
      defaultServiceId: current.defaultServiceId ?? nextService.id,
    };
    await this.persist(next);
    return next;
  }

  async setDefault(id: string): Promise<AiSettingsSnapshot> {
    const current = await this.load();
    if (!current.services.some((service) => service.id === id)) {
      throw new Error('找不到要设为默认的 AI 服务');
    }
    const next = { ...current, defaultServiceId: id };
    await this.persist(next);
    return next;
  }

  async remove(id: string): Promise<AiSettingsSnapshot> {
    const current = await this.load();
    if (!current.services.some((service) => service.id === id)) return current;
    const services = current.services.filter((service) => service.id !== id);
    if (current.defaultServiceId === id && services.length > 0) {
      throw new Error('请先选择另一个默认 AI 服务');
    }
    const next: AiSettingsSnapshot = {
      services,
      defaultServiceId: services.length === 0 ? null : current.defaultServiceId,
    };
    await this.persist(next);
    return next;
  }

  async clear(): Promise<void> {
    await this.storage.removeItem(this.keys.current);
  }

  private async persist(snapshot: AiSettingsSnapshot): Promise<void> {
    const normalized = settingsOf(JSON.stringify(snapshot));
    if (!normalized) throw new Error('AI 服务配置无效');
    await this.storage.setItem(this.keys.current, JSON.stringify(normalized));
  }
}

export function createAiSettingsStore({ storage, keys }: AiSettingsStoreOptions): AiSettingsStore {
  return new AiSettingsStore(storage, keys);
}

function settingsOf(raw: string | null): AiSettingsSnapshot | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value) || !Array.isArray(value.services)) return null;
  const services: AiConfiguration[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const candidate of value.services) {
    const configuration = configurationOf(candidate);
    if (!configuration || ids.has(configuration.id)) return null;
    const normalizedName = configuration.name.toLocaleLowerCase();
    if (names.has(normalizedName)) return null;
    ids.add(configuration.id);
    names.add(normalizedName);
    services.push(configuration);
  }
  const defaultServiceId = typeof value.defaultServiceId === 'string'
    ? value.defaultServiceId
    : null;
  if (services.length === 0) {
    return defaultServiceId === null ? EMPTY_SETTINGS : null;
  }
  if (!defaultServiceId || !ids.has(defaultServiceId)) return null;
  return { services, defaultServiceId };
}

function configurationOf(value: unknown): AiConfiguration | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || !isProvider(value.provider)
    || !isProtocol(value.protocol)
    || typeof value.baseUrl !== 'string'
    || typeof value.apiKey !== 'string'
    || typeof value.model !== 'string'
  ) return null;
  try {
    return normalizeAiConfiguration({
      id: value.id,
      name: value.name,
      provider: value.provider,
      protocol: value.protocol,
      baseUrl: value.baseUrl,
      apiKey: value.apiKey,
      model: value.model,
    });
  } catch {
    return null;
  }
}

function isProvider(value: unknown): value is AiProvider {
  return value === 'openai' || value === 'deepseek' || value === 'custom';
}

function isProtocol(value: unknown): value is AiProtocol {
  return value === 'chat-completions' || value === 'responses';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createAiServiceId(): string {
  const value = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `ai-service-${value}`;
}
