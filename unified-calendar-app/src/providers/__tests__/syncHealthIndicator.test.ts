/**
 * Unit tests for SyncHealthIndicator.
 * Requirements: 18.5
 */

import { SyncHealthIndicator } from '../syncHealthIndicator';
import type { RateLimitEvent } from '../axiosFactory';

function makeEvent(accountId: string, retryCount: number = 1, timestamp?: number): RateLimitEvent {
  return {
    accountId,
    baseURL: 'https://api.example.com',
    retryAfterMs: 5000,
    retryCount,
    url: '/calendars/cal-1/events',
    timestamp: timestamp ?? Date.now(),
  };
}

describe('SyncHealthIndicator', () => {
  let indicator: SyncHealthIndicator;

  beforeEach(() => {
    indicator = new SyncHealthIndicator();
  });

  it('should report healthy when no events recorded', () => {
    const health = indicator.getHealth('acc-1');
    expect(health.status).toBe('healthy');
    expect(health.recentEvents).toHaveLength(0);
  });

  it('should report throttled after recording a rate limit event', () => {
    indicator.recordEvent(makeEvent('acc-1'));
    const health = indicator.getHealth('acc-1');
    expect(health.status).toBe('throttled');
    expect(health.recentEvents.length).toBeGreaterThan(0);
  });

  it('should track events per provider independently', () => {
    indicator.recordEvent(makeEvent('acc-1'));
    expect(indicator.getHealth('acc-1').status).toBe('throttled');
    expect(indicator.getHealth('acc-2').status).toBe('healthy');
  });

  it('should limit stored events per provider', () => {
    const small = new SyncHealthIndicator({ maxEventsPerProvider: 3 });
    for (let i = 0; i < 10; i++) {
      small.recordEvent(makeEvent('acc-1', i));
    }
    const log = small.getEventLog('acc-1');
    expect(log).toHaveLength(3);
    // Should keep the most recent
    expect(log[0].retryCount).toBe(7);
    expect(log[2].retryCount).toBe(9);
  });

  it('should return event log for a provider', () => {
    indicator.recordEvent(makeEvent('acc-1', 1));
    indicator.recordEvent(makeEvent('acc-1', 2));
    const log = indicator.getEventLog('acc-1');
    expect(log).toHaveLength(2);
    expect(log[0].retryCount).toBe(1);
    expect(log[1].retryCount).toBe(2);
  });

  it('should return empty log for unknown provider', () => {
    expect(indicator.getEventLog('unknown')).toEqual([]);
  });

  it('should detect throttled providers via hasThrottledProviders', () => {
    expect(indicator.hasThrottledProviders()).toBe(false);
    indicator.recordEvent(makeEvent('acc-1'));
    expect(indicator.hasThrottledProviders()).toBe(true);
  });

  it('should return all provider health via getAllHealth', () => {
    indicator.recordEvent(makeEvent('acc-1'));
    indicator.recordEvent(makeEvent('acc-2'));
    const all = indicator.getAllHealth();
    expect(all).toHaveLength(2);
    expect(all.every((h) => h.status === 'throttled')).toBe(true);
  });

  it('should clear all events', () => {
    indicator.recordEvent(makeEvent('acc-1'));
    indicator.recordEvent(makeEvent('acc-2'));
    indicator.clear();
    expect(indicator.hasThrottledProviders()).toBe(false);
    expect(indicator.getAllHealth()).toHaveLength(0);
  });

  it('should report healthy when all events are outside the throttle window', () => {
    // Use a short throttle window for testing
    const shortWindow = new SyncHealthIndicator({ throttleWindowMs: 1000 });
    // Record an event with a timestamp 2 seconds in the past
    const oldTimestamp = Date.now() - 2000;
    shortWindow.recordEvent(makeEvent('acc-1', 1, oldTimestamp));

    const health = shortWindow.getHealth('acc-1');
    expect(health.status).toBe('healthy');
    // lastThrottledAt should still reflect the event existed
    expect(health.lastThrottledAt).not.toBeNull();
  });

  it('should report throttled when events are within the throttle window', () => {
    const shortWindow = new SyncHealthIndicator({ throttleWindowMs: 60_000 });
    shortWindow.recordEvent(makeEvent('acc-1', 1, Date.now()));

    const health = shortWindow.getHealth('acc-1');
    expect(health.status).toBe('throttled');
  });
});
