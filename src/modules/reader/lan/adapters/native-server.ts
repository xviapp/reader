import { requireNativeModule } from 'expo';

import type { LanNativePort } from '../application/lan-controller';
import type { LanReadRequest, LanStopReason } from '../contracts';

export interface LanConditions {
  notificationsAllowed: boolean;
  batteryUnrestricted: boolean;
  backgroundRestricted: boolean;
}
interface LanNativeEvents {
  onRequest: LanReadRequest;
  onHealth: { serviceId: string };
  onStopped: { serviceId: string; reason: LanStopReason };
  onPages: { serviceId: string; count: number };
}
interface NativeServer extends LanNativePort {
  conditions(): Promise<LanConditions>;
  openBatterySettings(): Promise<void>;
  addListener<K extends keyof LanNativeEvents>(event: K, callback: (value: LanNativeEvents[K]) => void): { remove(): void };
}

export function nativeLanServer(): NativeServer { return requireNativeModule<NativeServer>('ReaderLanServer'); }
