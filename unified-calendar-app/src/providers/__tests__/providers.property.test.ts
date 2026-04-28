/**
 * Property-based tests for provider adapters.
 * Requirements: 1.4, 4.4
 */

import fc from 'fast-check';
import { TokenHealthMonitor, type TokenHealthChecker } from '../tokenHealthMonitor';
import { CalDAVAdapter, type CalDAVAdapterConfig } from '../caldavAdapter';
import type { CalendarAccount } from '../../types/models';
import type { TokenHealthStatus } from '../../types/auth';
import type { SecureStorage, RefreshToken } from '../types';
import axios from 'axios';

// ── Mock axios (required by CalDAVAdapter's base class) ──────────────
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// ── Helpers ──────────────────────────────────────────────────────────

/** Create a minimal CalendarAccount for testing */
function makeAccount(id: string): CalendarAccount {
  return {
    id,
    userId: 'user-1',
    providerId: 'google',
    displayName: `Account ${id}`,
    email: `${id}@example.com`,
    color: '#4285F4',
    visibility: 'public',
    syncToken: null,
    lastSyncedAt: null,
    status: 'active',
    createdAt: new Date(),
  };
}

/** In-memory SecureStorage for testing */
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

// Feature: unified-calendar-app, Property 26: Token revocation detection within 30 seconds
// **Validates: Requirements 1.4**
describe('Property 26: Token revocation detection within 30 seconds', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('onTokenRevoked fires within 30s of provider token revocation', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a random interval between 1ms and 30000ms for the monitor
        fc.integer({ min: 1, max: 30_000 }),
        async (intervalMs) => {
          // Track whether the callback fired
          let callbackFired = false;

          // The checker returns 'valid' on the first call, then 'revoked'
          let callCount = 0;
          const checker: TokenHealthChecker = jest.fn().mockImplementation(
            () => {
              callCount++;
              return Promise.resolve(callCount === 1 ? 'valid' : 'revoked');
            },
          );

          const monitor = new TokenHealthMonitor({
            checkHealth: checker,
            intervalMs,
          });

          monitor.onTokenRevoked = () => {
            callbackFired = true;
          };

          // Start monitoring — runs initial check immediately (returns 'valid')
          monitor.startMonitoring([makeAccount('acc-1')]);

          // Await the initial async health check
          await monitor.waitForCheck();

          // Advance time by the configured interval to trigger the next check
          jest.advanceTimersByTime(intervalMs);

          // Await the second async health check (returns 'revoked')
          await monitor.waitForCheck();

          // The callback must have fired within one interval (≤ 30s)
          expect(callbackFired).toBe(true);
          expect(intervalMs).toBeLessThanOrEqual(30_000);

          monitor.stopMonitoring();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: unified-calendar-app, Property 32: Polling interval compliance
// **Validates: Requirements 4.4**
describe('Property 32: Polling interval compliance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue({
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      request: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    } as any);
  });

  it('CalDAVAdapter clamps pollingIntervalMs to ≤ 300000ms for any input', () => {
    fc.assert(
      fc.property(
        // Generate random polling interval values including values above the max
        fc.integer({ min: 1, max: 1_000_000 }),
        (inputInterval) => {
          const config: CalDAVAdapterConfig = {
            storage: createMockStorage(),
            accountId: 'test-account',
            refreshTokenInfo: REFRESH_TOKEN,
            serverUrl: 'https://caldav.example.com',
            calendarHomePath: '/user/calendars/',
            pollingIntervalMs: inputInterval,
          };

          const adapter = new CalDAVAdapter(config);

          // The effective polling interval must never exceed 300000ms (5 minutes)
          expect(adapter.pollingIntervalMs).toBeLessThanOrEqual(300_000);

          // If the input was within bounds, it should be used as-is
          if (inputInterval <= 300_000) {
            expect(adapter.pollingIntervalMs).toBe(inputInterval);
          } else {
            // If the input exceeded the max, it should be clamped to 300000
            expect(adapter.pollingIntervalMs).toBe(300_000);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('CalDAVAdapter defaults to 300000ms when no pollingIntervalMs is provided', () => {
    const config: CalDAVAdapterConfig = {
      storage: createMockStorage(),
      accountId: 'test-account',
      refreshTokenInfo: REFRESH_TOKEN,
      serverUrl: 'https://caldav.example.com',
      calendarHomePath: '/user/calendars/',
    };

    const adapter = new CalDAVAdapter(config);
    expect(adapter.pollingIntervalMs).toBe(300_000);
  });
});
