/**
 * Android secure storage implementation using expo-secure-store (Android Keystore).
 * Requirements: 13.2
 */

import type { SecureStorage } from './types';

/**
 * Creates a SecureStorage backed by Android Keystore via expo-secure-store.
 */
export function createSecureStorage(): SecureStorage {
  // Lazy import to avoid bundling on non-Android platforms
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SecureStore = require('expo-secure-store');

  return {
    async getItem(key: string): Promise<string | null> {
      return SecureStore.getItemAsync(key);
    },
    async setItem(key: string, value: string): Promise<void> {
      await SecureStore.setItemAsync(key, value);
    },
    async removeItem(key: string): Promise<void> {
      await SecureStore.deleteItemAsync(key);
    },
  };
}
