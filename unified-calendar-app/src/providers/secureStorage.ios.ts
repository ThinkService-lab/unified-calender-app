/**
 * iOS secure storage implementation using expo-secure-store (iOS Keychain).
 * Requirements: 13.2
 */

import type { SecureStorage } from './types';

/**
 * Creates a SecureStorage backed by iOS Keychain via expo-secure-store.
 */
export function createSecureStorage(): SecureStorage {
  // Lazy import to avoid bundling on non-iOS platforms
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SecureStore = require('expo-secure-store');

  return {
    async getItem(key: string): Promise<string | null> {
      return SecureStore.getItemAsync(key);
    },
    async setItem(key: string, value: string): Promise<void> {
      await SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    },
    async removeItem(key: string): Promise<void> {
      await SecureStore.deleteItemAsync(key);
    },
  };
}
