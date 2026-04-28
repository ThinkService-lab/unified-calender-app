/**
 * Unit tests for Axios factory with auth interceptors.
 * Requirements: 1.2, 1.5, 18.2
 */

import axios from 'axios';
import { createProviderAxios, parseRetryAfter, type AxiosFactoryOptions, type RateLimitEvent } from '../axiosFactory';
import { OAuthConnector } from '../oauthConnector';
import type { SecureStorage, AuthResult } from '../types';

/** In-memory SecureStorage for testing */
function createMockStorage(): SecureStorage {
  const store = new Map<string, string>();
  return {
    async getItem(key: string) { return store.get(key) ?? null; },
    async setItem(key: string, value: string) { store.set(key, value); },
    async removeItem(key: string) { store.delete(key); },
  };
}

describe('createProviderAxios', () => {
  let storage: SecureStorage;
  let connector: OAuthConnector;

  beforeEach(() => {
    storage = createMockStorage();
    connector = new OAuthConnector(storage);
  });

  it('should create an Axios instance with correct baseURL', () => {
    const instance = createProviderAxios({
      baseURL: 'https://api.example.com',
      accountId: 'test_account',
      oauthConnector: connector,
      refreshTokenInfo: {
        token: 'refresh_token',
        clientId: 'client_id',
        tokenEndpoint: 'https://auth.example.com/token',
      },
    });

    expect(instance.defaults.baseURL).toBe('https://api.example.com');
  });

  it('should set the configured timeout', () => {
    const instance = createProviderAxios({
      baseURL: 'https://api.example.com',
      accountId: 'test_account',
      oauthConnector: connector,
      refreshTokenInfo: {
        token: 'refresh_token',
        clientId: 'client_id',
        tokenEndpoint: 'https://auth.example.com/token',
      },
      timeout: 5000,
    });

    expect(instance.defaults.timeout).toBe(5000);
  });

  it('should use default timeout of 8000ms when not specified', () => {
    const instance = createProviderAxios({
      baseURL: 'https://api.example.com',
      accountId: 'test_account',
      oauthConnector: connector,
      refreshTokenInfo: {
        token: 'refresh_token',
        clientId: 'client_id',
        tokenEndpoint: 'https://auth.example.com/token',
      },
    });

    expect(instance.defaults.timeout).toBe(8000);
  });

  it('should have request and response interceptors', () => {
    const instance = createProviderAxios({
      baseURL: 'https://api.example.com',
      accountId: 'test_account',
      oauthConnector: connector,
      refreshTokenInfo: {
        token: 'refresh_token',
        clientId: 'client_id',
        tokenEndpoint: 'https://auth.example.com/token',
      },
    });

    // Axios interceptors manager has handlers array
    expect((instance.interceptors.request as any).handlers.length).toBeGreaterThan(0);
    expect((instance.interceptors.response as any).handlers.length).toBeGreaterThan(0);
  });

  it('should set Content-Type header to application/json', () => {
    const instance = createProviderAxios({
      baseURL: 'https://api.example.com',
      accountId: 'test_account',
      oauthConnector: connector,
      refreshTokenInfo: {
        token: 'refresh_token',
        clientId: 'client_id',
        tokenEndpoint: 'https://auth.example.com/token',
      },
    });

    expect(instance.defaults.headers['Content-Type']).toBe('application/json');
  });
});

describe('parseRetryAfter', () => {
  it('should parse integer seconds', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter('60')).toBe(60000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('should return default for null/undefined', () => {
    expect(parseRetryAfter(null)).toBe(5000);
    expect(parseRetryAfter(undefined)).toBe(5000);
    expect(parseRetryAfter('')).toBe(5000);
  });

  it('should parse HTTP-date format', () => {
    const futureDate = new Date(Date.now() + 10000).toUTCString();
    const result = parseRetryAfter(futureDate);
    // Should be approximately 10 seconds (within 2s tolerance)
    expect(result).toBeGreaterThan(8000);
    expect(result).toBeLessThan(12000);
  });

  it('should return 0 for past HTTP-date', () => {
    const pastDate = new Date(Date.now() - 10000).toUTCString();
    expect(parseRetryAfter(pastDate)).toBe(0);
  });

  it('should return default for unparseable string', () => {
    expect(parseRetryAfter('not-a-number-or-date')).toBe(5000);
  });
});
