import type { AiExecutionLease, AiTaskResultNotification } from './ai-task-runner';

interface NativeAiExecutionModule {
  start(activeCount: number): Promise<void>;
  stop(): Promise<void>;
  notifyTaskResult(
    taskId: string,
    targetId: string,
    title: string,
    succeeded: boolean,
    appVisible: boolean,
  ): Promise<boolean>;
  addListener(eventName: 'onStopAll', listener: () => void): { remove(): void };
}

const nativePromises = new Map<string, Promise<NativeAiExecutionModule | null>>();

async function nativeModule(moduleName: string): Promise<NativeAiExecutionModule | null> {
  let nativePromise = nativePromises.get(moduleName);
  if (!nativePromise) {
    nativePromise = (async () => {
      try {
        const expo = await import('expo');
        return expo.requireOptionalNativeModule<NativeAiExecutionModule>(moduleName);
      } catch {
        // Node-based domain tests and unsupported platforms do not have Expo's
        // native module registry. The foreground lease is optional there.
        return null;
      }
    })();
    nativePromises.set(moduleName, nativePromise);
  }
  return nativePromise;
}

export class NativeAiExecutionLease implements AiExecutionLease {
  constructor(private readonly moduleName: string) {}

  async setActiveTaskCount(count: number): Promise<void> {
    const native = await nativeModule(this.moduleName);
    if (!native) return;
    if (count > 0) await native.start(count);
    else await native.stop();
  }

  onStopAll(listener: () => void): () => void {
    let active = true;
    let subscription: { remove(): void } | null = null;
    void nativeModule(this.moduleName).then((native) => {
      if (active && native) subscription = native.addListener('onStopAll', listener);
    });
    return () => {
      active = false;
      subscription?.remove();
    };
  }

  async notifyTaskResult(notification: AiTaskResultNotification): Promise<void> {
    const native = await nativeModule(this.moduleName);
    if (!native) return;
    await native.notifyTaskResult(
      notification.taskId,
      notification.targetId,
      notification.title,
      notification.outcome === 'succeeded',
      false,
    );
  }
}
