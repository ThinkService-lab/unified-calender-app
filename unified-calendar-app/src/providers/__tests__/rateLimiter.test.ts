/**
 * Unit tests for PriorityRateLimiter.
 * Requirements: 18.1, 18.4
 */

import { PriorityRateLimiter, RateLimitDeferredError } from '../rateLimiter';

describe('PriorityRateLimiter', () => {
  it('should start with zero count', () => {
    const limiter = new PriorityRateLimiter({ maxRequests: 100, windowMs: 60000 });
    expect(limiter.currentCount).toBe(0);
  });

  it('should increment count on acquire', async () => {
    const limiter = new PriorityRateLimiter({ maxRequests: 100, windowMs: 60000 });
    await limiter.acquire('user');
    expect(limiter.currentCount).toBe(1);
  });

  it('should allow user requests up to the limit', async () => {
    const limiter = new PriorityRateLimiter({ maxRequests: 10, windowMs: 60000 });
    for (let i = 0; i < 10; i++) {
      await limiter.acquire('user');
    }
    expect(limiter.currentCount).toBe(10);
  });

  it('should defer background requests when approaching limit (>80%)', async () => {
    const limiter = new PriorityRateLimiter({ maxRequests: 10, windowMs: 60000 });

    // Fill to 80% capacity (8 requests)
    for (let i = 0; i < 8; i++) {
      await limiter.acquire('user');
    }

    // Background request should be deferred
    await expect(limiter.acquire('background')).rejects.toThrow(RateLimitDeferredError);
  });

  it('should still allow user requests when approaching limit', async () => {
    const limiter = new PriorityRateLimiter({ maxRequests: 10, windowMs: 60000 });

    // Fill to 80% capacity
    for (let i = 0; i < 8; i++) {
      await limiter.acquire('user');
    }

    // User request should still work
    await expect(limiter.acquire('user')).resolves.toBeUndefined();
    expect(limiter.currentCount).toBe(9);
  });

  it('should report isApproachingLimit correctly', async () => {
    const limiter = new PriorityRateLimiter({ maxRequests: 10, windowMs: 60000 });

    expect(limiter.isApproachingLimit).toBe(false);

    for (let i = 0; i < 8; i++) {
      await limiter.acquire('user');
    }

    expect(limiter.isApproachingLimit).toBe(true);
  });

  it('should report isAtLimit correctly', async () => {
    const limiter = new PriorityRateLimiter({ maxRequests: 5, windowMs: 60000 });

    expect(limiter.isAtLimit).toBe(false);

    for (let i = 0; i < 5; i++) {
      await limiter.acquire('user');
    }

    expect(limiter.isAtLimit).toBe(true);
  });

  it('should reset count', async () => {
    const limiter = new PriorityRateLimiter({ maxRequests: 10, windowMs: 60000 });
    await limiter.acquire('user');
    await limiter.acquire('user');
    limiter.reset();
    expect(limiter.currentCount).toBe(0);
  });

  it('should allow background requests below threshold', async () => {
    const limiter = new PriorityRateLimiter({ maxRequests: 10, windowMs: 60000 });

    // Fill to 70% (below 80% threshold)
    for (let i = 0; i < 7; i++) {
      await limiter.acquire('user');
    }

    // Background request should work
    await expect(limiter.acquire('background')).resolves.toBeUndefined();
  });

  it('RateLimitDeferredError should have isDeferred flag', async () => {
    const limiter = new PriorityRateLimiter({ maxRequests: 10, windowMs: 60000 });

    for (let i = 0; i < 8; i++) {
      await limiter.acquire('user');
    }

    try {
      await limiter.acquire('background');
      fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitDeferredError);
      expect((err as RateLimitDeferredError).isDeferred).toBe(true);
    }
  });
});
