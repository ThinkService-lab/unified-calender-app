/**
 * Unit tests for TokenHealthMonitor.
 * Requirements: 1.4
 */

import { TokenHealthMonitor, type TokenHealthChecker } from '../tokenHealthMonitor';
import type { CalendarAccount } from '../../types/models';
import type { TokenHealthStatus } from '../../types/auth';

/** Helper to create a minimal CalendarAccount for testing */
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

describe('TokenHealthMonitor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('checkTokenHealth', () => {
    it('should return the status from the health checker', async () => {
      const checker: TokenHealthChecker = jest.fn().mockResolvedValue('valid');
      const monitor = new TokenHealthMonitor({ checkHealth: checker });

      const status = await monitor.checkTokenHealth('acc-1');
      expect(status).toBe('valid');
      expect(checker).toHaveBeenCalledWith('acc-1');
    });

    it('should return "unknown" when the health checker throws', async () => {
      const checker: TokenHealthChecker = jest.fn().mockRejectedValue(new Error('network error'));
      const monitor = new TokenHealthMonitor({ checkHealth: checker });

      const status = await monitor.checkTokenHealth('acc-1');
      expect(status).toBe('unknown');
    });

    it('should return "expired" when checker reports expired', async () => {
      const checker: TokenHealthChecker = jest.fn().mockResolvedValue('expired');
      const monitor = new TokenHealthMonitor({ checkHealth: checker });

      const status = await monitor.checkTokenHealth('acc-1');
      expect(status).toBe('expired');
    });

    it('should return "revoked" when checker reports revoked', async () => {
      const checker: TokenHealthChecker = jest.fn().mockResolvedValue('revoked');
      const monitor = new TokenHealthMonitor({ checkHealth: checker });

      const status = await monitor.checkTokenHealth('acc-1');
      expect(status).toBe('revoked');
    });
  });

  describe('startMonitoring / stopMonitoring', () => {
    it('should run an initial health check immediately on start', async () => {
      const checker: TokenHealthChecker = jest.fn().mockResolvedValue('valid');
      const monitor = new TokenHealthMonitor({ checkHealth: checker, intervalMs: 30_000 });

      monitor.startMonitoring([makeAccount('acc-1')]);
      await monitor.waitForCheck();

      expect(checker).toHaveBeenCalledWith('acc-1');
      monitor.stopMonitoring();
    });

    it('should check all monitored accounts on each interval tick', async () => {
      const checker: TokenHealthChecker = jest.fn().mockResolvedValue('valid');
      const monitor = new TokenHealthMonitor({ checkHealth: checker, intervalMs: 30_000 });

      monitor.startMonitoring([makeAccount('acc-1'), makeAccount('acc-2')]);
      await monitor.waitForCheck();
      expect(checker).toHaveBeenCalledTimes(2);

      // Advance by one interval
      jest.advanceTimersByTime(30_000);
      await monitor.waitForCheck();
      expect(checker).toHaveBeenCalledTimes(4);

      monitor.stopMonitoring();
    });

    it('should stop checking after stopMonitoring is called', async () => {
      const checker: TokenHealthChecker = jest.fn().mockResolvedValue('valid');
      const monitor = new TokenHealthMonitor({ checkHealth: checker, intervalMs: 30_000 });

      monitor.startMonitoring([makeAccount('acc-1')]);
      await monitor.waitForCheck();
      expect(checker).toHaveBeenCalledTimes(1);

      monitor.stopMonitoring();

      jest.advanceTimersByTime(60_000);
      // No additional calls after stop
      expect(checker).toHaveBeenCalledTimes(1);
    });

    it('should replace monitored accounts when startMonitoring is called again', async () => {
      const checker: TokenHealthChecker = jest.fn().mockResolvedValue('valid');
      const monitor = new TokenHealthMonitor({ checkHealth: checker, intervalMs: 30_000 });

      monitor.startMonitoring([makeAccount('acc-1')]);
      await monitor.waitForCheck();
      expect(checker).toHaveBeenCalledWith('acc-1');

      // Restart with different accounts
      monitor.startMonitoring([makeAccount('acc-2')]);
      await monitor.waitForCheck();
      expect(checker).toHaveBeenCalledWith('acc-2');

      monitor.stopMonitoring();
    });
  });

  describe('onTokenRevoked callback', () => {
    it('should fire when a token transitions from valid to revoked', async () => {
      let callCount = 0;
      const statuses: Record<string, TokenHealthStatus[]> = {
        'acc-1': ['valid', 'revoked'],
      };
      const checker: TokenHealthChecker = jest.fn().mockImplementation(
        (accountId: string) => Promise.resolve(statuses[accountId]?.shift() ?? 'valid'),
      );

      const monitor = new TokenHealthMonitor({ checkHealth: checker, intervalMs: 30_000 });
      const revokedIds: string[] = [];
      monitor.onTokenRevoked = (id) => { revokedIds.push(id); callCount++; };

      monitor.startMonitoring([makeAccount('acc-1')]);

      // Initial check: valid — no callback
      await monitor.waitForCheck();
      expect(callCount).toBe(0);

      // Next interval: revoked — callback fires
      jest.advanceTimersByTime(30_000);
      await monitor.waitForCheck();
      expect(callCount).toBe(1);
      expect(revokedIds).toEqual(['acc-1']);

      monitor.stopMonitoring();
    });

    it('should fire when a token transitions from valid to expired', async () => {
      const statuses: Record<string, TokenHealthStatus[]> = {
        'acc-1': ['valid', 'expired'],
      };
      const checker: TokenHealthChecker = jest.fn().mockImplementation(
        (accountId: string) => Promise.resolve(statuses[accountId]?.shift() ?? 'valid'),
      );

      const monitor = new TokenHealthMonitor({ checkHealth: checker, intervalMs: 30_000 });
      const revokedIds: string[] = [];
      monitor.onTokenRevoked = (id) => { revokedIds.push(id); };

      monitor.startMonitoring([makeAccount('acc-1')]);
      await monitor.waitForCheck();

      jest.advanceTimersByTime(30_000);
      await monitor.waitForCheck();

      expect(revokedIds).toEqual(['acc-1']);
      monitor.stopMonitoring();
    });

    it('should NOT fire repeatedly for the same revoked status', async () => {
      const checker: TokenHealthChecker = jest.fn()
        .mockResolvedValueOnce('valid')
        .mockResolvedValue('revoked');

      const monitor = new TokenHealthMonitor({ checkHealth: checker, intervalMs: 30_000 });
      let callCount = 0;
      monitor.onTokenRevoked = () => { callCount++; };

      monitor.startMonitoring([makeAccount('acc-1')]);

      // Initial: valid
      await monitor.waitForCheck();
      expect(callCount).toBe(0);

      // Tick 1: revoked — fires
      jest.advanceTimersByTime(30_000);
      await monitor.waitForCheck();
      expect(callCount).toBe(1);

      // Tick 2: still revoked — should NOT fire again
      jest.advanceTimersByTime(30_000);
      await monitor.waitForCheck();
      expect(callCount).toBe(1);

      monitor.stopMonitoring();
    });

    it('should fire again if token recovers then revokes again', async () => {
      const statuses: TokenHealthStatus[] = ['valid', 'revoked', 'valid', 'revoked'];
      const checker: TokenHealthChecker = jest.fn().mockImplementation(
        () => Promise.resolve(statuses.shift() ?? 'valid'),
      );

      const monitor = new TokenHealthMonitor({ checkHealth: checker, intervalMs: 30_000 });
      let callCount = 0;
      monitor.onTokenRevoked = () => { callCount++; };

      monitor.startMonitoring([makeAccount('acc-1')]);

      // Initial: valid
      await monitor.waitForCheck();
      expect(callCount).toBe(0);

      // Tick 1: revoked — fires
      jest.advanceTimersByTime(30_000);
      await monitor.waitForCheck();
      expect(callCount).toBe(1);

      // Tick 2: valid — no fire
      jest.advanceTimersByTime(30_000);
      await monitor.waitForCheck();
      expect(callCount).toBe(1);

      // Tick 3: revoked again — fires again
      jest.advanceTimersByTime(30_000);
      await monitor.waitForCheck();
      expect(callCount).toBe(2);

      monitor.stopMonitoring();
    });

    it('should NOT fire when status is unknown', async () => {
      const checker: TokenHealthChecker = jest.fn()
        .mockResolvedValueOnce('valid')
        .mockResolvedValue('unknown');

      const monitor = new TokenHealthMonitor({ checkHealth: checker, intervalMs: 30_000 });
      let callCount = 0;
      monitor.onTokenRevoked = () => { callCount++; };

      monitor.startMonitoring([makeAccount('acc-1')]);
      await monitor.waitForCheck();

      jest.advanceTimersByTime(30_000);
      await monitor.waitForCheck();

      expect(callCount).toBe(0);
      monitor.stopMonitoring();
    });

    it('should handle multiple accounts independently', async () => {
      const statusMap: Record<string, TokenHealthStatus[]> = {
        'acc-1': ['valid', 'revoked'],
        'acc-2': ['valid', 'valid'],
      };
      const checker: TokenHealthChecker = jest.fn().mockImplementation(
        (accountId: string) => Promise.resolve(statusMap[accountId]?.shift() ?? 'valid'),
      );

      const monitor = new TokenHealthMonitor({ checkHealth: checker, intervalMs: 30_000 });
      const revokedIds: string[] = [];
      monitor.onTokenRevoked = (id) => { revokedIds.push(id); };

      monitor.startMonitoring([makeAccount('acc-1'), makeAccount('acc-2')]);
      await monitor.waitForCheck();

      jest.advanceTimersByTime(30_000);
      await monitor.waitForCheck();

      // Only acc-1 should have fired
      expect(revokedIds).toEqual(['acc-1']);
      monitor.stopMonitoring();
    });
  });

  describe('30-second interval compliance', () => {
    it('should use 30-second default interval', async () => {
      const checker: TokenHealthChecker = jest.fn().mockResolvedValue('valid');
      const monitor = new TokenHealthMonitor({ checkHealth: checker });

      monitor.startMonitoring([makeAccount('acc-1')]);
      await monitor.waitForCheck();
      // 1 call from initial check
      expect(checker).toHaveBeenCalledTimes(1);

      // At 29 seconds — no new check yet
      jest.advanceTimersByTime(29_000);
      expect(checker).toHaveBeenCalledTimes(1);

      // At 30 seconds — new check
      jest.advanceTimersByTime(1_000);
      await monitor.waitForCheck();
      expect(checker).toHaveBeenCalledTimes(2);

      monitor.stopMonitoring();
    });

    it('should detect revocation within 30 seconds of status change', async () => {
      const checker: TokenHealthChecker = jest.fn()
        .mockResolvedValueOnce('valid')
        .mockResolvedValue('revoked');

      const monitor = new TokenHealthMonitor({ checkHealth: checker, intervalMs: 30_000 });
      let revoked = false;
      monitor.onTokenRevoked = () => { revoked = true; };

      monitor.startMonitoring([makeAccount('acc-1')]);
      await monitor.waitForCheck();
      expect(revoked).toBe(false);

      // Advance exactly 30 seconds — the next check fires
      jest.advanceTimersByTime(30_000);
      await monitor.waitForCheck();

      expect(revoked).toBe(true);
      monitor.stopMonitoring();
    });
  });
});
