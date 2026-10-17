import { APP_CONFIG } from '@/core/app-config';
import * as SecureStore from 'expo-secure-store';

import { createAiSettingsStore as createConfiguredAiSettingsStore, type AiSettingsStore } from './ai-settings-core';

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export function createAiSettingsStore(): AiSettingsStore {
  return createConfiguredAiSettingsStore({
    storage: {
      getItem: (key) => SecureStore.getItemAsync(key, secureOptions),
      setItem: (key, value) => SecureStore.setItemAsync(key, value, secureOptions),
      removeItem: (key) => SecureStore.deleteItemAsync(key, secureOptions),
    },
    keys: {
      current: APP_CONFIG.ai.settingsKey,
    },
  });
}
