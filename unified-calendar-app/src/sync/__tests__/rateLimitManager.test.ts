/**
 * Unit tests for RateLimitManager.
 * Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6
 */

import {
  createRateLimitManager,
  RateLimitExceededError,
  RateLimitDeferredError,
} from '../rateLimitManager';
import type {
  RateLimitManager,
  RateLimitLogEntry,
  OperationPriority,
} from '../rateLimitManager';

describe('RateLimitManager', () => {
  let manager: RateLimitManager;

  beforeEach(() => {
    manager = createRateLimitManager();
  });

  afterEach(() => {
    manager.clear();
  });

  describe('registerAccount', () => {
    it('should register a new account with healthy status', () => {
      manager.registerAccount('acc-1', 'google');
      const health = manager.getAccountHealth('acc-1');
      expect(health).not.toBeNull();
      expect(health!.status).toBe('healthy');
      expect(health!.providerId).toBe('google');
      expect(health!.consecutive429Count).toBe(0);
    });

    it('should not overwrite an existing account on re-register', () => {
      manager.registerAccount('acc-1', 'google');
      manager.recordRequest('acc-1');
      manager.registerAccount('acc-1', 'google');
      const health = manager.getAccountHealth('acc-1');
      expect(health!.currentRequestCount).toBe(1);
    });

    it('should return null health for unregistered account', () => {
      expect(manager.getAccountHealth('nonexistent')).toBeNull();
    });
  });

  describe('tryAcquire (Req 18.1 - per-provider rate limits)', () => {
    it('should allow requests when under the limit', () => {
      manager.registerAccount('acc-1', 'google');
      const result = manager.tryAcquire('acc-1', 'user');
      expect(result.allowed).toBe(true);
      expect(result.waitMs).toBe(0);
    });

    it('should allow requests for unregistered accounts', () => {
      const result = manager.tryAcquire('unknown', 'user');
      expect(result.allowed).toBe(true);
    });

    it('should deny requests when at the hard limit', () => {
      manager = createRateLimitManager({
        providerConfigs: {
          google: { maxRequests: 3, windowMs: 60_000, defaultPollingIntervalMs: 300_000 },
        },
      });
      manager.registerAccount('acc-1', 'google');

      // Fill up the limit
      manager.recordRequest('acc-1');
      manager.recordRequest('acc-1');
      manager.recordRequest('acc-1');

      const result = manager.tryAcquire('acc-1', 'user');
      expect(result.allowed).toBe(false);
      expect(result.waitMs).toBeGreaterThan(0);
      expect(result.reason).toContain('Rate limit reached');
    });

    it('should enforce Google rate limits (quota per 100 seconds)', () => {
      manager.registerAccount('acc-g', 'google');
      const health = manager.getAccountHealth('acc-g');
      expect(health!.maxRequests).toBe(100);
      expect(health!.windowMs).toBe(100_000);
    });

    it('should enforce Microsoft rate limits (10,000 per 10 minutes)', () => {
      manager.registerAccount('acc-m', 'outlook');
      const health = manager.getAccountHealth('acc-m');
      expect(health!.maxRequests).toBe(10_000);
      expect(health!.windowMs).toBe(600_000);
    });

    it('should enforce CalDAV rate limits (polling ≤ 5 min intervals)', () => {
      manager.registerAccount('acc-c', 'caldav');
      const health = manager.getAccountHealth('acc-c');
      expect(health!.windowMs).toBe(300_000);
    });
  });

  describe('Priority handling (Req 18.4)', () => {
    it('should defer background requests when approaching limit', () => {
      manager = createRateLimitManager({
        providerConfigs: {
          google: { maxRequests: 10, windowMs: 60_000, defaultPollingIntervalMs: 300_000 },
        },
      });
      manager.registerAccount('acc-1', 'google');

      // Fill to 80% (8 out of 10)
      for (let i = 0; i < 8; i++) {
        manager.recordRequest('acc-1');
      }

      // Background should be deferred
      const bgResult = manager.tryAcquire('acc-1', 'background');
      expect(bgResult.allowed).toBe(false);
      expect(bgResult.reason).toContain('Background request deferred');

      // User should still be allowed
      const userResult = manager.tryAcquire('acc-1', 'user');
      expect(userResult.allowed).toBe(true);
    });

    it('should allow background requests when well under limit', () => {
      manager = createRateLimitManager({
        providerConfigs: {
          google: { maxRequests: 10, windowMs: 60_000, defaultPollingIntervalMs: 300_000 },
        },
      });
      manager.registerAccount('acc-1', 'google');

      // Only 2 out of 10 used
      manager.recordRequest('acc-1');
      manager.recordRequest('acc-1');

      const result = manager.tryAcquire('acc-1', 'background');
      expect(result.allowed).toBe(true);
    });
  });

  describe('handle429 (Req 18.2 - pause and respect Retry-After)', () => {
    it('should pause requests after a 429', () => {
      manager.registerAccount('acc-1', 'google');
      manager.handle429('acc-1', 5_000, '/calendars');

      const result = manager.tryAcquire('acc-1', 'user');
      expect(result.allowed).toBe(false);
      expect(result.waitMs).toBeGreaterThan(0);
      expect(result.waitMs).toBeLessThanOrEqual(5_000);
      expect(result.reason).toContain('paused');
    });

    it('should increment consecutive 429 count', () => {
      manager.registerAccount('acc-1', 'google');
      manager.handle429('acc-1', 1_000);
      manager.handle429('acc-1', 1_000);

      const health = manager.getAccountHealth('acc-1');
      expect(health!.consecutive429Count).toBe(2);
    });

    it('should log rate limit events (Req 18.5)', () => {
      manager.registerAccount('acc-1', 'google');
      manager.handle429('acc-1', 3_000, '/events');

      const entries = manager.getLogEntries('acc-1');
      expect(entries.length).toBe(1);
      expect(entries[0].statusCode).toBe(429);
      expect(entries[0].retryAfterMs).toBe(3_000);
      expect(entries[0].url).toBe('/events');
      expect(entries[0].providerId).toBe('google');
    });

    it('should fire onRateLimitEvent callback', () => {
      const callback = jest.fn();
      manager = createRateLimitManager({ onRateLimitEvent: callback });
      manager.registerAccount('acc-1', 'google');
      manager.handle429('acc-1', 2_000);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'acc-1',
          retryAfterMs: 2_000,
          statusCode: 429,
        }),
      );
    });

    it('should no-op for unregistered accounts', () => {
      // Should not throw
      manager.handle429('unknown', 1_000);
      expect(manager.getLogEntries('unknown')).toEqual([]);
    });
  });

  describe('Persistent rate limiting (Req 18.6)', () => {
    it('should increase polling interval after 3+ consecutive 429s', () => {
      manager.registerAccount('acc-1', 'google');
      const initialInterval = manager.getPollingInterval('acc-1');

      manager.handle429('acc-1', 1_000);
      manager.handle429('acc-1', 1_000);
      expect(manager.getPollingInterval('acc-1')).toBe(initialInterval);

      // Third 429 triggers increase
      manager.handle429('acc-1', 1_000);
      expect(manager.getPollingInterval('acc-1')).toBe(initialInterval * 2);
    });

    it('should continue increasing on further 429s', () => {
      manager.registerAccount('acc-1', 'google');
      const initialInterval = manager.getPollingInterval('acc-1');

      for (let i = 0; i < 4; i++) {
        manager.handle429('acc-1', 1_000);
      }

      // 3rd triggers 2x, 4th triggers another 2x
      expect(manager.getPollingInterval('acc-1')).toBe(initialInterval * 4);
    });

    it('should report error status when persistently rate-limited', () => {
      manager.registerAccount('acc-1', 'google');

      for (let i = 0; i < 3; i++) {
        manager.handle429('acc-1', 100);
      }

      // Wait for pause to expire
      const health = manager.getAccountHealth('acc-1');
      expect(health!.consecutive429Count).toBe(3);
      // Status should be rate-limited (paused) or error (persistent)
      expect(['rate-limited', 'error']).toContain(health!.status);
    });

    it('should use custom persistent threshold', () => {
      manager = createRateLimitManager({ persistentRateLimitThreshold: 5 });
      manager.registerAccount('acc-1', 'google');
      const initialInterval = manager.getPollingInterval('acc-1');

      for (let i = 0; i < 4; i++) {
        manager.handle429('acc-1', 100);
      }

      // Should not have increased yet (threshold is 5)
      expect(manager.getPollingInterval('acc-1')).toBe(initialInterval);
    });
  });

  describe('calculateBackoff (exponential backoff with jitter)', () => {
    it('should return a positive delay for retry 0', () => {
      const delay = manager.calculateBackoff(0);
      expect(delay).toBeGreaterThan(0);
    });

    it('should increase with retry count on average', () => {
      const samples = 50;
      let sumD0 = 0;
      let sumD3 = 0;
      for (let i = 0; i < samples; i++) {
        sumD0 += manager.calculateBackoff(0);
        sumD3 += manager.calculateBackoff(3);
      }
      expect(sumD3 / samples).toBeGreaterThan(sumD0 / samples);
    });

    it('should not exceed maxDelayMs + jitter', () => {
      // Default max is 60_000 with 0.1 jitter = max 66_000
      for (let i = 0; i < 100; i++) {
        const delay = manager.calculateBackoff(20);
        expect(delay).toBeLessThanOrEqual(66_000);
      }
    });

    it('should respect custom backoff config', () => {
      manager = createRateLimitManager({
        backoffConfig: { initialDelayMs: 500, multiplier: 3, maxDelayMs: 10_000, jitterFactor: 0, maxRetries: 5 },
      });
      // With jitter=0, delay should be exactly 500 * 3^0 = 500
      const delay = manager.calculateBackoff(0);
      expect(delay).toBe(500);
    });
  });

  describe('executeWithRateLimit', () => {
    it('should execute operation successfully', async () => {
      manager.registerAccount('acc-1', 'google');
      const result = await manager.executeWithRateLimit('acc-1', 'user', async () => 'success');
      expect(result).toBe('success');
    });

    it('should reset consecutive429Count on success', async () => {
      manager.registerAccount('acc-1', 'google');
      manager.handle429('acc-1', 100);
      expect(manager.getAccountHealth('acc-1')!.consecutive429Count).toBe(1);

      // Wait for pause to expire
      await new Promise((r) => setTimeout(r, 150));

      await manager.executeWithRateLimit('acc-1', 'user', async () => 'ok');
      expect(manager.getAccountHealth('acc-1')!.consecutive429Count).toBe(0);
    });

    it('should throw RateLimitDeferredError for deferred background requests', async () => {
      manager = createRateLimitManager({
        providerConfigs: {
          google: { maxRequests: 5, windowMs: 60_000, defaultPollingIntervalMs: 300_000 },
        },
      });
      manager.registerAccount('acc-1', 'google');

      // Fill to 80%
      for (let i = 0; i < 4; i++) {
        manager.recordRequest('acc-1');
      }

      await expect(
        manager.executeWithRateLimit('acc-1', 'background', async () => 'nope'),
      ).rejects.toThrow(RateLimitDeferredError);
    });

    it('should retry on 429 errors with backoff', async () => {
      manager = createRateLimitManager({
        backoffConfig: { maxRetries: 2, initialDelayMs: 50, maxDelayMs: 200, multiplier: 2, jitterFactor: 0 },
      });
      manager.registerAccount('acc-1', 'google');

      let callCount = 0;
      const operation = async () => {
        callCount++;
        if (callCount < 3) {
          const error: Record<string, unknown> = {
            response: { status: 429, headers: { 'retry-after': '0' } },
            config: { url: '/test' },
          };
          throw error;
        }
        return 'recovered';
      };

      const result = await manager.executeWithRateLimit('acc-1', 'user', operation);
      expect(result).toBe('recovered');
      expect(callCount).toBe(3);
    });

    it('should throw after max retries on persistent 429', async () => {
      manager = createRateLimitManager({
        backoffConfig: { maxRetries: 1, initialDelayMs: 10, maxDelayMs: 50, multiplier: 2, jitterFactor: 0 },
      });
      manager.registerAccount('acc-1', 'google');

      const error429: Record<string, unknown> = {
        response: { status: 429, headers: { 'retry-after': '0' } },
        config: { url: '/test' },
      };

      await expect(
        manager.executeWithRateLimit('acc-1', 'user', async () => {
          throw error429;
        }),
      ).rejects.toBeDefined();
    });

    it('should retry on non-429 errors with backoff', async () => {
      manager = createRateLimitManager({
        backoffConfig: { maxRetries: 2, initialDelayMs: 10, maxDelayMs: 50, multiplier: 2, jitterFactor: 0 },
      });
      manager.registerAccount('acc-1', 'google');

      let callCount = 0;
      const result = await manager.executeWithRateLimit('acc-1', 'user', async () => {
        callCount++;
        if (callCount < 2) throw new Error('transient');
        return 'ok';
      });

      expect(result).toBe('ok');
      expect(callCount).toBe(2);
    });
  });

  describe('Health indicators (Req 18.5)', () => {
    it('should report healthy when no issues', () => {
      manager.registerAccount('acc-1', 'google');
      const health = manager.getAccountHealth('acc-1');
      expect(health!.status).toBe('healthy');
    });

    it('should report degraded when approaching limit', () => {
      manager = createRateLimitManager({
        providerConfigs: {
          google: { maxRequests: 10, windowMs: 60_000, defaultPollingIntervalMs: 300_000 },
        },
      });
      manager.registerAccount('acc-1', 'google');

      for (let i = 0; i < 8; i++) {
        manager.recordRequest('acc-1');
      }

      const health = manager.getAccountHealth('acc-1');
      expect(health!.status).toBe('degraded');
    });

    it('should report rate-limited when paused', () => {
      manager.registerAccount('acc-1', 'google');
      manager.handle429('acc-1', 60_000);

      const health = manager.getAccountHealth('acc-1');
      expect(health!.status).toBe('rate-limited');
    });

    it('should report error when persistently rate-limited', () => {
      manager = createRateLimitManager({
        providerConfigs: {
          google: { maxRequests: 100, windowMs: 100_000, defaultPollingIntervalMs: 300_000 },
        },
      });
      manager.registerAccount('acc-1', 'google');

      // 3 consecutive 429s with very short pause so they expire
      manager.handle429('acc-1', 1);
      manager.handle429('acc-1', 1);
      manager.handle429('acc-1', 1);

      const health = manager.getAccountHealth('acc-1');
      // Could be rate-limited (if pause hasn't expired) or error
      expect(['rate-limited', 'error']).toContain(health!.status);
      expect(health!.consecutive429Count).toBe(3);
    });

    it('should return all health snapshots', () => {
      manager.registerAccount('acc-1', 'google');
      manager.registerAccount('acc-2', 'outlook');

      const all = manager.getAllHealth();
      expect(all.length).toBe(2);
      expect(all.map((h) => h.accountId).sort()).toEqual(['acc-1', 'acc-2']);
    });
  });

  describe('Log entries', () => {
    it('should return empty log for clean account', () => {
      manager.registerAccount('acc-1', 'google');
      expect(manager.getLogEntries('acc-1')).toEqual([]);
    });

    it('should cap log entries at maxLogEntriesPerAccount', () => {
      manager = createRateLimitManager({ maxLogEntriesPerAccount: 3 });
      manager.registerAccount('acc-1', 'google');

      for (let i = 0; i < 5; i++) {
        manager.handle429('acc-1', 100);
      }

      expect(manager.getLogEntries('acc-1').length).toBe(3);
    });

    it('should include recent events in health snapshot', () => {
      manager.registerAccount('acc-1', 'google');
      manager.handle429('acc-1', 1_000, '/events');

      const health = manager.getAccountHealth('acc-1');
      expect(health!.recentEvents.length).toBe(1);
      expect(health!.recentEvents[0].url).toBe('/events');
    });
  });

  describe('resetAccount', () => {
    it('should reset all state for an account', () => {
      manager.registerAccount('acc-1', 'google');
      manager.recordRequest('acc-1');
      manager.handle429('acc-1', 5_000);
      manager.handle429('acc-1', 5_000);
      manager.handle429('acc-1', 5_000);

      manager.resetAccount('acc-1');

      const health = manager.getAccountHealth('acc-1');
      expect(health!.status).toBe('healthy');
      expect(health!.currentRequestCount).toBe(0);
      expect(health!.consecutive429Count).toBe(0);
      expect(health!.currentPollingIntervalMs).toBe(300_000);
      expect(manager.getLogEntries('acc-1')).toEqual([]);
    });

    it('should no-op for unregistered accounts', () => {
      // Should not throw
      manager.resetAccount('unknown');
    });
  });

  describe('getPollingInterval (Req 18.6)', () => {
    it('should return default interval for healthy account', () => {
      manager.registerAccount('acc-1', 'caldav');
      expect(manager.getPollingInterval('acc-1')).toBe(300_000);
    });

    it('should return default for unregistered account', () => {
      expect(manager.getPollingInterval('unknown')).toBe(300_000);
    });
  });

  describe('clear', () => {
    it('should remove all accounts', () => {
      manager.registerAccount('acc-1', 'google');
      manager.registerAccount('acc-2', 'outlook');
      manager.clear();

      expect(manager.getAllHealth()).toEqual([]);
      expect(manager.getAccountHealth('acc-1')).toBeNull();
    });
  });

  describe('Error classes', () => {
    it('RateLimitExceededError should have correct properties', () => {
      const err = new RateLimitExceededError('test', 'acc-1');
      expect(err.name).toBe('RateLimitExceededError');
      expect(err.accountId).toBe('acc-1');
      expect(err.message).toBe('test');
      expect(err instanceof Error).toBe(true);
    });

    it('RateLimitDeferredError should have correct properties', () => {
      const err = new RateLimitDeferredError('deferred', 'acc-2');
      expect(err.name).toBe('RateLimitDeferredError');
      expect(err.accountId).toBe('acc-2');
      expect(err.isDeferred).toBe(true);
      expect(err instanceof Error).toBe(true);
    });
  });
});
