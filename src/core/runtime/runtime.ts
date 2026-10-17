import type { AiEngine } from '@/core/ai/ai-engine';
import { createAiResponseStateStore } from '@/core/ai/ai-response-state';
import { AiTaskRunner, type AiExecutionLease } from '@/core/ai/ai-task-runner';
import {
  normalizeAiConfiguration,
  publicAiConfiguration,
  type AiConfiguration,
  type AiConfigurationInput,
  type AiSettingsSnapshot,
  type AiSettingsStore,
} from '@/core/ai/ai-settings-core';
import { DirectAiAdapter } from '@/core/ai/direct-ai-adapter';
import { APP_CONFIG } from '@/core/app-config';
import { LOCAL_WORKSPACE_ID, type LocalDatabase } from '@/core/data/database-contract';
import { localState } from '@/core/storage/local-state';
import type { MediaLibrary } from '@/core/media/media-library';
import type { OcrEngine } from '@/core/ocr/ocr-engine';
import { registerReaderAiTasks } from '@/modules/reader/application/reader-ai';
import { LocalReaderRepository } from '@/modules/reader/data/reader-repository';

export type ReaderDataPhase = 'initializing' | 'ready' | 'error';
export type ReaderAiPhase = 'loading' | 'ready' | 'unconfigured' | 'error';
export type PublicAiConfiguration = Omit<AiConfiguration, 'apiKey'>;

export interface ReaderRuntimeSnapshot {
  workspaceId: string;
  dataPhase: ReaderDataPhase;
  dataError: string | null;
  database: LocalDatabase | null;
  aiPhase: ReaderAiPhase;
  aiError: string | null;
  aiTaskError: string | null;
  aiConfiguration: PublicAiConfiguration | null;
  aiServices: readonly PublicAiConfiguration[];
  defaultAiServiceId: string | null;
  ai: AiEngine | null;
  aiTasks: AiTaskRunner | null;
  media: MediaLibrary;
  ocr: OcrEngine;
  actionPending: boolean;
  reportAiTaskError(message: string | null): void;
  aiForService(id: string): AiEngine | null;
}

type Listener = () => void;

const EMPTY_AI_SETTINGS: AiSettingsSnapshot = { services: [], defaultServiceId: null };
const RUNTIME_GLOBAL_KEY = '__readerProcessRuntimeV1';

type RuntimeGlobal = typeof globalThis & {
  [RUNTIME_GLOBAL_KEY]?: ReaderRuntime;
};

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export interface ReaderRuntimeDependencies {
  media: MediaLibrary;
  ocr: OcrEngine;
  executionLease: AiExecutionLease;
}

const EMPTY_MEDIA: MediaLibrary = {
  selectImage: async () => { throw new Error('图片能力尚未准备好'); },
  optimizeImage: async () => { throw new Error('图片能力尚未准备好'); },
  rotateImage: async () => { throw new Error('图片能力尚未准备好'); },
  cropImage: async () => { throw new Error('图片能力尚未准备好'); },
  deleteImage: async () => undefined,
};

const EMPTY_OCR: OcrEngine = {
  recognize: async () => { throw new Error('OCR 能力尚未准备好'); },
};

const EMPTY_EXECUTION_LEASE: AiExecutionLease = {
  setActiveTaskCount: async () => undefined,
  onStopAll: () => () => undefined,
};

/** Owns Reader's database, media, OCR and durable AI work for the process. */
export class ReaderRuntime {
  private readonly listeners = new Set<Listener>();
  private readonly settingsStore: AiSettingsStore;
  private readonly responseState = createAiResponseStateStore({
    storage: localState,
    key: APP_CONFIG.ai.responseStateKey,
  });
  private readonly media: MediaLibrary;
  private readonly ocr: OcrEngine;
  private readonly aiExecutionLease: AiExecutionLease;
  private readonly createDatabase: () => LocalDatabase;
  private readonly createAi: (configuration: AiConfiguration) => AiEngine;
  private startup: Promise<void> | null = null;
  private dataGeneration = 0;
  private settingsGeneration = 0;
  private pendingActions = 0;
  private dataPhase: ReaderDataPhase = 'initializing';
  private dataError: string | null = null;
  private database: LocalDatabase | null = null;
  private aiPhase: ReaderAiPhase = 'loading';
  private aiError: string | null = null;
  private aiTaskError: string | null = null;
  private aiSettings: AiSettingsSnapshot = EMPTY_AI_SETTINGS;
  private aiEngines = new Map<string, AiEngine>();
  private aiTasks: AiTaskRunner | null = null;
  private removeAiTaskHandlers: (() => void) | null = null;
  private snapshot: ReaderRuntimeSnapshot;

  constructor(
    createDatabase: () => LocalDatabase,
    settings: AiSettingsStore,
    createAi?: (configuration: AiConfiguration) => AiEngine,
    dependencies: Partial<ReaderRuntimeDependencies> = {},
  ) {
    this.createDatabase = createDatabase;
    this.settingsStore = settings;
    this.media = dependencies.media ?? EMPTY_MEDIA;
    this.ocr = dependencies.ocr ?? EMPTY_OCR;
    this.aiExecutionLease = dependencies.executionLease ?? EMPTY_EXECUTION_LEASE;
    this.createAi = createAi ?? ((configuration) => new DirectAiAdapter({
      ...configuration,
      responseState: this.responseState,
    }));
    this.snapshot = this.buildSnapshot();
  }

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): ReaderRuntimeSnapshot => this.snapshot;

  readonly start = (): Promise<void> => {
    if (this.dataPhase === 'ready' && this.aiPhase !== 'loading') return Promise.resolve();
    if (this.startup) return this.startup;
    this.startup = Promise.all([this.loadAiSettings(), this.initializeDatabase()])
      .then(() => undefined)
      .finally(() => {
        if (this.dataPhase === 'error') {
          this.startup = null;
        }
      });
    return this.startup;
  };

  readonly retryData = (): void => {
    if (this.dataPhase !== 'error') return;
    void this.initializeDatabase();
  };

  readonly reportAiTaskError = (message: string | null): void => {
    this.aiTaskError = message;
    this.emit();
  };

  readonly aiForService = (id: string): AiEngine | null => this.aiEngines.get(id) ?? null;

  readonly saveAiService = async (input: AiConfigurationInput): Promise<boolean> => {
    return this.withAction(async () => {
      const generation = ++this.settingsGeneration;
      const settings = await this.settingsStore.upsert(input);
      if (input.id) await this.responseState.removeService(input.id).catch(() => undefined);
      if (generation !== this.settingsGeneration) return true;
      this.applyAiSettings(settings);
      return true;
    }, 'AI 配置保存失败');
  };

  readonly setDefaultAiService = async (id: string): Promise<boolean> => {
    return this.withAction(async () => {
      const generation = ++this.settingsGeneration;
      if (id !== this.aiSettings.defaultServiceId) await this.responseState.clear().catch(() => undefined);
      const settings = await this.settingsStore.setDefault(id);
      if (generation !== this.settingsGeneration) return true;
      this.applyAiSettings(settings);
      return true;
    }, '默认 AI 服务切换失败');
  };

  readonly removeAiService = async (id: string): Promise<boolean> => {
    return this.withAction(async () => {
      if (this.aiTasks && await this.aiTasks.hasUnfinishedService(id)) {
        throw new Error('这个服务仍被未完成的 AI 任务使用，请先完成或停止相关任务');
      }
      const generation = ++this.settingsGeneration;
      const settings = await this.settingsStore.remove(id);
      await this.responseState.removeService(id).catch(() => undefined);
      if (generation !== this.settingsGeneration) return true;
      this.applyAiSettings(settings);
      return true;
    }, 'AI 服务删除失败');
  };

  readonly testAiService = async (input: AiConfigurationInput): Promise<boolean> => {
    return this.withAction(async () => {
      const existing = input.id
        ? this.aiSettings.services.find((service) => service.id === input.id)
        : null;
      const configuration = normalizeAiConfiguration(input, existing?.apiKey);
      await this.createAi(configuration).generate({ messages: [{ role: 'user', content: '只回复 OK' }] });
      return true;
    }, 'AI 服务测试失败');
  };

  private async initializeDatabase(): Promise<void> {
    const generation = ++this.dataGeneration;
    const previousDatabase = this.database;
    const previousTasks = this.aiTasks;
    const previousHandlers = this.removeAiTaskHandlers;
    this.database = null;
    this.aiTasks = null;
    this.removeAiTaskHandlers = null;
    this.dataPhase = 'initializing';
    this.dataError = null;
    this.aiTaskError = null;
    this.emit();

    previousHandlers?.();
    await previousTasks?.dispose().catch(() => undefined);
    await previousDatabase?.close().catch(() => undefined);

    const database = this.createDatabase();
    try {
      await database.initialize();
      if (generation !== this.dataGeneration) {
        await database.close().catch(() => undefined);
        return;
      }
      this.database = database;
      this.dataPhase = 'ready';
      this.emit();

      const tasks = new AiTaskRunner(database, LOCAL_WORKSPACE_ID, this.aiExecutionLease);
      try {
        await tasks.start();
        const repository = new LocalReaderRepository(database, LOCAL_WORKSPACE_ID);
        const removeHandlers = await registerReaderAiTasks(repository, tasks, this.aiForService);
        if (generation !== this.dataGeneration) {
          removeHandlers();
          await tasks.dispose().catch(() => undefined);
          return;
        }
        this.aiTasks = tasks;
        this.removeAiTaskHandlers = removeHandlers;
        this.emit();
      } catch (error) {
        await tasks.dispose().catch(() => undefined);
        if (generation !== this.dataGeneration) return;
        this.aiTaskError = safeMessage(error, 'AI 后台任务初始化失败');
        this.emit();
      }
    } catch (error) {
      await database.close().catch(() => undefined);
      if (generation !== this.dataGeneration) return;
      this.database = null;
      this.dataPhase = 'error';
      this.dataError = safeMessage(error, '本地数据库初始化失败');
      this.emit();
    }
  }

  private async loadAiSettings(): Promise<void> {
    const generation = ++this.settingsGeneration;
    try {
      const settings = await this.settingsStore.load();
      if (generation !== this.settingsGeneration) return;
      this.applyAiSettings(settings);
    } catch (error) {
      if (generation !== this.settingsGeneration) return;
      this.aiError = safeMessage(error, 'AI 配置读取失败');
      this.aiPhase = 'error';
      this.emit();
    }
  }

  private applyAiSettings(settings: AiSettingsSnapshot): void {
    this.aiSettings = settings;
    this.aiEngines = new Map(settings.services.map((configuration) => [
      configuration.id,
      this.createAi(configuration),
    ]));
    this.aiError = null;
    this.aiPhase = settings.defaultServiceId ? 'ready' : 'unconfigured';
    this.emit();
  }

  private async withAction(action: () => Promise<boolean>, fallback: string): Promise<boolean> {
    if (this.pendingActions > 0) return false;
    this.pendingActions += 1;
    this.aiError = null;
    this.emit();
    try {
      void this.start();
      return await action();
    } catch (error) {
      this.aiError = safeMessage(error, fallback);
      this.emit();
      return false;
    } finally {
      this.pendingActions -= 1;
      this.emit();
    }
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  private buildSnapshot(): ReaderRuntimeSnapshot {
    const services = this.aiSettings.services.map(publicAiConfiguration);
    return {
      workspaceId: LOCAL_WORKSPACE_ID,
      dataPhase: this.dataPhase,
      dataError: this.dataError,
      database: this.database,
      aiPhase: this.aiPhase,
      aiError: this.aiError,
      aiTaskError: this.aiTaskError,
      aiConfiguration: this.aiSettings.defaultServiceId
        ? services.find((service) => service.id === this.aiSettings.defaultServiceId) ?? null
        : null,
      aiServices: services,
      defaultAiServiceId: this.aiSettings.defaultServiceId,
      ai: this.aiSettings.defaultServiceId ? this.aiForService(this.aiSettings.defaultServiceId) : null,
      aiTasks: this.aiTasks,
      media: this.media,
      ocr: this.ocr,
      actionPending: this.pendingActions > 0,
      reportAiTaskError: this.reportAiTaskError,
      aiForService: this.aiForService,
    };
  }
}

export function processReaderRuntime(factory: () => ReaderRuntime): ReaderRuntime {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  runtimeGlobal[RUNTIME_GLOBAL_KEY] ??= factory();
  return runtimeGlobal[RUNTIME_GLOBAL_KEY];
}

export function resetProcessReaderRuntime(): void {
  const runtimeGlobal = globalThis as RuntimeGlobal;
  delete runtimeGlobal[RUNTIME_GLOBAL_KEY];
}
