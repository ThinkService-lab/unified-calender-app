/**
 * Unit tests for createCachedTokenHealthChecker.
 *
 * Security Review 2026-05-02 (pass 3): Finding L6
 *
 * These tests enforce the contract that the cached checker:
 *   - Short-circuits to 'valid' when local expiry is well in the future
 *   - Short-circuits to 'expired' when local expiry is past
 *   - Forces a network probe when `recentlyRejected` is set, even if
 *     expiry looks valid
 *   - Caches probe results for the configured TTL
 *   - Invalidates the cache on demand
 */

import { createCachedTokenHealthChecker } from '../cachedTokenHealth';
import type { TokenHealthChecker } from '../tokenHealthMonitor';
import type { TokenExpiryProvider } from '../cachedTokenHealth';

describe('createCachedTokenHealthChecker', () => {
  let currentTime: number;
  const nowFn = () => currentTime;

  beforeEach(() => {
    currentTime = 1_700_000_000_000; // 2023-11-14T22:13:20Z
  });

  describe('without tokenExpiryProvider', () => {
    it('probes on first call and caches the result', async () => {
      const raw: TokenHealthChecker = jest.fn().mockResolvedValue('valid');
      const checker = createCachedTokenHealthChecker({ rawChecker: raw, now: nowFn });

      expect(await checker('acc-1')).toBe('valid');
      expect(await checker('acc-1')).toBe('valid');
      expect(await checker('acc-1')).toBe('valid');

      expect(raw).toHaveBeenCalledTimes(1);
    });

    it('re-probes after cache TTL expires', async () => {
      const raw: TokenHealthChecker = jest.fn().mockResolvedValue('valid');
      const checker = createCachedTokenHealthChecker({
        rawChecker: raw,
        cacheTtlMs: 60_000,
        now: nowFn,
      });

      await checker('acc-1');
      currentTime += 30_000;
      await checker('acc-1');
      expect(raw).toHaveBeenCalledTimes(1);

      currentTime += 31_000; // total 61s
      await checker('acc-1');
      expect(raw).toHaveBeenCalledTimes(2);
    });

    it('caches per-account independently', async () => {
      const raw: TokenHealthChecker = jest
        .fn()
        .mockImplementation(async (id: string) => (id === 'acc-1' ? 'valid' : 'revoked'));
      const checker = createCachedTokenHealthChecker({ rawChecker: raw, now: nowFn });

      expect(await checker('acc-1')).toBe('valid');
      expect(await checker('acc-2')).toBe('revoked');
      expect(await checker('acc-1')).toBe('valid');
      expect(await checker('acc-2')).toBe('revoked');

      expect(raw).toHaveBeenCalledTimes(2);
    });

    it('invalidate() clears one account', async () => {
      const raw: TokenHealthChecker = jest
        .fn()
        .mockResolvedValueOnce('valid')
        .mockResolvedValueOnce('valid');
      const checker = createCachedTokenHealthChecker({ rawChecker: raw, now: nowFn });

      await checker('acc-1');
      checker.invalidate('acc-1');
      await checker('acc-1');

      expect(raw).toHaveBeenCalledTimes(2);
    });

    it('invalidate() with no arg clears all accounts', async () => {
      const raw: TokenHealthChecker = jest.fn().mockResolvedValue('valid');
      const checker = createCachedTokenHealthChecker({ rawChecker: raw, now: nowFn });

      await checker('acc-1');
      await checker('acc-2');
      checker.invalidate();
      await checker('acc-1');
      await checker('acc-2');

      expect(raw).toHaveBeenCalledTimes(4);
    });
  });

  describe('with tokenExpiryProvider', () => {
    it('short-circuits to valid when expiry is in the future', async () => {
      const raw: TokenHealthChecker = jest.fn().mockResolvedValue('revoked');
      const provider: TokenExpiryProvider = () => ({
        expiresAt: currentTime + 10 * 60 * 1000, // 10 minutes from now
      });
      const checker = createCachedTokenHealthChecker({
        rawChecker: raw,
        tokenExpiryProvider: provider,
        now: nowFn,
      });

      expect(await checker('acc-1')).toBe('valid');
      expect(await checker('acc-1')).toBe('valid');
      expect(raw).not.toHaveBeenCalled();
    });

    it('short-circuits to expired when expiry is past', async () => {
      const raw: TokenHealthChecker = jest.fn().mockResolvedValue('valid');
      const provider: TokenExpiryProvider = () => ({
        expiresAt: currentTime - 1000,
      });
      const checker = createCachedTokenHealthChecker({
        rawChecker: raw,
        tokenExpiryProvider: provider,
        now: nowFn,
      });

      expect(await checker('acc-1')).toBe('expired');
      expect(raw).not.toHaveBeenCalled();
    });

    it('treats tokens inside the skew window as expired', async () => {
      const raw: TokenHealthChecker = jest.fn().mockResolvedValue('valid');
      const provider: TokenExpiryProvider = () => ({
        expiresAt: currentTime + 30_000, // 30 seconds — within 60s skew
      });
      const checker = createCachedTokenHealthChecker({
        rawChecker: raw,
        tokenExpiryProvider: provider,
        now: nowFn,
      });

      expect(await checker('acc-1')).toBe('expired');
      expect(raw).not.toHaveBeenCalled();
    });

    it('forces a network probe when recentlyRejected is true', async () => {
      const raw: TokenHealthChecker = jest.fn().mockResolvedValue('revoked');
      const provider: TokenExpiryProvider = () => ({
        expiresAt: currentTime + 10 * 60 * 1000,
        recentlyRejected: true,
      });
      const checker = createCachedTokenHealthChecker({
        rawChecker: raw,
        tokenExpiryProvider: provider,
        now: nowFn,
      });

      expect(await checker('acc-1')).toBe('revoked');
      expect(raw).toHaveBeenCalledTimes(1);
    });

    it('falls back to network probe when provider returns null', async () => {
      const raw: TokenHealthChecker = jest.fn().mockResolvedValue('valid');
      const provider: TokenExpiryProvider = () => null;
      const checker = createCachedTokenHealthChecker({
        rawChecker: raw,
        tokenExpiryProvider: provider,
        now: nowFn,
      });

      expect(await checker('acc-1')).toBe('valid');
      expect(raw).toHaveBeenCalledTimes(1);
    });

    it('falls back to network probe when provider throws', async () => {
      const raw: TokenHealthChecker = jest.fn().mockResolvedValue('valid');
      const provider: TokenExpiryProvider = () => {
        throw new Error('storage unavailable');
      };
      const checker = createCachedTokenHealthChecker({
        rawChecker: raw,
        tokenExpiryProvider: provider,
        now: nowFn,
      });

      expect(await checker('acc-1')).toBe('valid');
      expect(raw).toHaveBeenCalledTimes(1);
    });

    it('supports async expiry providers', async () => {
      const raw: TokenHealthChecker = jest.fn().mockResolvedValue('revoked');
      const provider: TokenExpiryProvider = async () => ({
        expiresAt: currentTime + 10 * 60 * 1000,
      });
      const checker = createCachedTokenHealthChecker({
        rawChecker: raw,
        tokenExpiryProvider: provider,
        now: nowFn,
      });

      expect(await checker('acc-1')).toBe('valid');
      expect(raw).not.toHaveBeenCalled();
    });

    it('falls back to probe when expiresAt is null', async () => {
      const raw: TokenHealthChecker = jest.fn().mockResolvedValue('valid');
      const provider: TokenExpiryProvider = () => ({ expiresAt: null });
      const checker = createCachedTokenHealthChecker({
        rawChecker: raw,
        tokenExpiryProvider: provider,
        now: nowFn,
      });

      expect(await checker('acc-1')).toBe('valid');
      expect(raw).toHaveBeenCalledTimes(1);
    });
  });

  describe('rate-limit amplification prevention', () => {
    it('on 30-second polling over an hour with a fresh token, does zero network calls', async () => {
      const raw: TokenHealthChecker = jest.fn().mockResolvedValue('valid');
      const provider: TokenExpiryProvider = () => ({
        expiresAt: currentTime + 60 * 60 * 1000, // 1 hour
      });
      const checker = createCachedTokenHealthChecker({
        rawChecker: raw,
        tokenExpiryProvider: provider,
        now: nowFn,
      });

      // Simulate 120 polls (one per 30s over 1 hour)
      for (let i = 0; i < 120; i++) {
        await checker('acc-1');
        currentTime += 30_000;
      }

      expect(raw).toHaveBeenCalledTimes(0);
    });

    it('without expiry provider, caps probe calls to 12 per hour on 30s polling (5-min TTL)', async () => {
      const raw: TokenHealthChecker = jest.fn().mockResolvedValue('valid');
      const checker = createCachedTokenHealthChecker({ rawChecker: raw, now: nowFn });

      for (let i = 0; i < 120; i++) {
        await checker('acc-1');
        currentTime += 30_000;
      }

      // With a 5-minute TTL, at most 12 probes in 60 minutes (60 / 5 = 12).
      // First call probes immediately, then every 5 minutes after.
      expect(raw).toHaveBeenCalledTimes(12);
    });
  });
});
