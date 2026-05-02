/**
 * Unit tests for web secure storage implementation.
 * Requirements: 13.2
 */

import { createSecureStorage } from '../secureStorage.web';
import type { SecureStorage } from '../types';

// Mock localStorage for Node test environment
const localStorageMap = new Map<string, string>();
const mockLocalStorage = {
  getItem: (key: string) => localStorageMap.get(key) ?? null,
  setItem: (key: string, value: string) => localStorageMap.set(key, value),
  removeItem: (key: string) => localStorageMap.delete(key),
  clear: () => localStorageMap.clear(),
  get length() { return localStorageMap.size; },
  key: (_index: number) => null as string | null,
};

Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
});

describe('Web SecureStorage', () => {
  let storage: SecureStorage;

  beforeEach(() => {
    localStorageMap.clear();
    storage = createSecureStorage();
  });

  it('should store and retrieve a value', async () => {
    await storage.setItem('test_key', 'test_value');
    const result = await storage.getItem('test_key');
    expect(result).toBe('test_value');
  });

  it('should return null for non-existent key', async () => {
    const result = await storage.getItem('nonexistent');
    expect(result).toBeNull();
  });

  it('should remove a stored value', async () => {
    await storage.setItem('key_to_remove', 'value');
    await storage.removeItem('key_to_remove');
    const result = await storage.getItem('key_to_remove');
    expect(result).toBeNull();
  });

  it('should handle special characters in values', async () => {
    const specialValue = 'token=abc123&scope=calendar+email';
    await storage.setItem('special', specialValue);
    const result = await storage.getItem('special');
    expect(result).toBe(specialValue);
  });

  it('should handle JSON token data', async () => {
    const tokenData = JSON.stringify({
      accessToken: 'ya29.abc123',
      refreshToken: '1//0abc',
      expiresIn: 3600,
    });
    await storage.setItem('tokens', tokenData);
    const result = await storage.getItem('tokens');
    expect(result).toBe(tokenData);
    expect(JSON.parse(result!)).toEqual(JSON.parse(tokenData));
  });

  it('should overwrite existing values', async () => {
    await storage.setItem('key', 'value1');
    await storage.setItem('key', 'value2');
    const result = await storage.getItem('key');
    expect(result).toBe('value2');
  });

  it('should isolate keys with storage prefix', async () => {
    await storage.setItem('mykey', 'myvalue');
    // The raw localStorage key should have the prefix
    const rawKey = Array.from(localStorageMap.keys()).find((k) => k.includes('mykey'));
    expect(rawKey).toContain('ucal_secure_');
  });
});

describe('Web SecureStorage — security review M8 / L7', () => {
  beforeEach(() => {
    localStorageMap.clear();
    // Reset the module-local key between suites that depend on key identity
    const mod = jest.requireActual('../secureStorage.web') as {
      _resetEncryptionKeyForTesting: () => void;
    };
    mod._resetEncryptionKeyForTesting();
  });

  it('does NOT persist the encryption key in localStorage or sessionStorage (M8)', async () => {
    const storage = createSecureStorage();
    await storage.setItem('tokens', 'secret-token-value');

    // The AES key must never appear in any web storage surface.
    const keysInLocal = Array.from(localStorageMap.keys());
    expect(keysInLocal.some((k) => k.toLowerCase().includes('key'))).toBe(false);
    expect(keysInLocal.some((k) => k.toLowerCase().includes('crypto'))).toBe(false);

    // Ciphertext is stored, plaintext must not be:
    const allValues = Array.from(localStorageMap.values()).join('|');
    expect(allValues).not.toContain('secret-token-value');
  });

  it('invokes onAuthReset when stored ciphertext cannot be decrypted (L7)', async () => {
    // Seed a corrupted entry with the expected storage prefix
    localStorageMap.set('ucal_secure_corrupted', 'not-valid-base64-ciphertext!!!');

    const authResetEvents: Array<{ key: string; reason: string }> = [];
    const storage = createSecureStorage({
      onAuthReset: (key, reason) => {
        authResetEvents.push({ key, reason });
      },
    });

    const result = await storage.getItem('corrupted');
    expect(result).toBeNull();
    expect(authResetEvents).toEqual([{ key: 'corrupted', reason: 'decryption_failed' }]);
    // And the corrupted entry should be purged
    expect(localStorageMap.has('ucal_secure_corrupted')).toBe(false);
  });

  it('is resilient to a throwing onAuthReset handler', async () => {
    localStorageMap.set('ucal_secure_corrupted', 'not-valid-ciphertext');
    const storage = createSecureStorage({
      onAuthReset: () => {
        throw new Error('handler crashed');
      },
    });

    // Must not propagate the handler error
    await expect(storage.getItem('corrupted')).resolves.toBeNull();
  });

  it('generates a non-extractable CryptoKey (M8)', async () => {
    // Stub crypto.subtle.generateKey to capture the extractable flag
    const realGenerate = crypto.subtle.generateKey.bind(crypto.subtle);
    let capturedExtractable: boolean | null = null;
    const spy = jest
      .spyOn(crypto.subtle, 'generateKey')
      .mockImplementation(((algo: any, extractable: boolean, usages: any) => {
        capturedExtractable = extractable;
        return realGenerate(algo, extractable, usages);
      }) as typeof crypto.subtle.generateKey);

    try {
      const storage = createSecureStorage();
      await storage.setItem('probe', 'v');
    } finally {
      spy.mockRestore();
    }

    expect(capturedExtractable).toBe(false);
  });
});
