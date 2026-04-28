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
