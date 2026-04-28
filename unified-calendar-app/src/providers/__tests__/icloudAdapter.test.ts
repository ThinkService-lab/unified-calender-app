/**
 * Unit tests for ICloudCalendarAdapter.
 * Requirements: 1.1
 */

import axios from 'axios';
import { ICloudCalendarAdapter, type ICloudAdapterConfig } from '../icloudAdapter';
import type { SecureStorage, RefreshToken } from '../types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function createMockAxiosInstance() {
  return {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    request: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
}

function createMockStorage(): SecureStorage {
  const store = new Map<string, string>();
  return {
    async getItem(key: string) { return store.get(key) ?? null; },
    async setItem(key: string, value: string) { store.set(key, value); },
    async removeItem(key: string) { store.delete(key); },
  };
}

const REFRESH_TOKEN: RefreshToken = {
  token: 'refresh_tok',
  clientId: 'client_id',
  tokenEndpoint: 'https://auth.example.com/token',
};

describe('ICloudCalendarAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue(createMockAxiosInstance() as any);
  });

  it('should have providerId "icloud"', () => {
    const adapter = new ICloudCalendarAdapter({
      storage: createMockStorage(),
      accountId: 'test-account',
      refreshTokenInfo: REFRESH_TOKEN,
      calendarHomePath: '/1234567890/calendars/',
    });

    expect(adapter.providerId).toBe('icloud');
  });

  it('should use iCloud CalDAV server URL', () => {
    const adapter = new ICloudCalendarAdapter({
      storage: createMockStorage(),
      accountId: 'test-account',
      refreshTokenInfo: REFRESH_TOKEN,
      calendarHomePath: '/1234567890/calendars/',
    });

    // The adapter should be a CalDAV adapter under the hood
    expect(adapter).toBeInstanceOf(ICloudCalendarAdapter);
  });

  it('should have default polling interval of 5 minutes', () => {
    const adapter = new ICloudCalendarAdapter({
      storage: createMockStorage(),
      accountId: 'test-account',
      refreshTokenInfo: REFRESH_TOKEN,
      calendarHomePath: '/1234567890/calendars/',
    });

    expect(adapter.pollingIntervalMs).toBe(300_000);
  });

  it('should accept custom polling interval', () => {
    const adapter = new ICloudCalendarAdapter({
      storage: createMockStorage(),
      accountId: 'test-account',
      refreshTokenInfo: REFRESH_TOKEN,
      calendarHomePath: '/1234567890/calendars/',
      pollingIntervalMs: 120_000,
    });

    expect(adapter.pollingIntervalMs).toBe(120_000);
  });

  it('should NOT have setupPushNotification (inherited from CalDAV)', () => {
    const adapter = new ICloudCalendarAdapter({
      storage: createMockStorage(),
      accountId: 'test-account',
      refreshTokenInfo: REFRESH_TOKEN,
      calendarHomePath: '/1234567890/calendars/',
    });

    expect((adapter as any).setupPushNotification).toBeUndefined();
  });

  it('should support adaptive polling via onRateLimitHit/onSuccessfulSync', () => {
    const adapter = new ICloudCalendarAdapter({
      storage: createMockStorage(),
      accountId: 'test-account',
      refreshTokenInfo: REFRESH_TOKEN,
      calendarHomePath: '/1234567890/calendars/',
    });

    expect(adapter.effectivePollingIntervalMs).toBe(300_000);
    adapter.onRateLimitHit();
    expect(adapter.effectivePollingIntervalMs).toBe(600_000);
    adapter.onSuccessfulSync();
    expect(adapter.effectivePollingIntervalMs).toBe(300_000);
  });
});
