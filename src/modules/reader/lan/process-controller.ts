import { ReaderLanController } from './application/lan-controller';
import { nativeLanServer } from './adapters/native-server';
import { registerLanRestoreBarrier } from './application/restore-barrier';

let controller: ReaderLanController | null = null;

export function readerLanController(): ReaderLanController {
  if (controller) return controller;
  const native = nativeLanServer();
  const instance = new ReaderLanController(native);
  controller = instance;
  registerLanRestoreBarrier(() => instance.stop('restore'));
  native.addListener('onRequest', (request) => { void instance.request(request); });
  native.addListener('onHealth', ({ serviceId }) => { void instance.health(serviceId); });
  native.addListener('onStopped', ({ serviceId, reason }) => { instance.onStopped(serviceId, reason); });
  native.addListener('onPages', ({ serviceId, count }) => { instance.onPages(serviceId, count); });
  return instance;
}
