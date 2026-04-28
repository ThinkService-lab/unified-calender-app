/**
 * Sync health indicator that tracks rate limit events per provider.
 * Exposes throttled/healthy status and recent rate limit event log.
 * Requirements: 18.5
 */

import type { RateLimitEvent } from './axiosFactory';

export interface ProviderHealth {
  providerId: string;
  status: 'healthy' | 'throttled';
  recentEvents: RateLimitEvent[];
  lastThrottledAt: Date | null;
}

/**
 * Tracks rate limit events and exposes per-provider health status.
 * A provider is considered "throttled" if it had a rate limit event
 * within the last `throttleWindowMs` (default 5 minutes).
 */
export class SyncHealthIndicator {
  private events: Map<string, RateLimitEvent[]> = new Map();
  private readonly maxEventsPerProvider: number;
  private readonly throttleWindowMs: number;

  constructor(options?: { maxEventsPerProvider?: number; throttleWindowMs?: number }) {
    this.maxEventsPerProvider = options?.maxEventsPerProvider ?? 50;
    this.throttleWindowMs = options?.throttleWindowMs ?? 5 * 60 * 1000;
  }

  /**
   * Record a rate limit event. Wire this to axiosFactory's onRateLimitEvent callback.
   */
  recordEvent(event: RateLimitEvent): void {
    const key = event.accountId;
    const existing = this.events.get(key) ?? [];
    existing.push(event);

    // Keep only the most recent N events
    if (existing.length > this.maxEventsPerProvider) {
      existing.splice(0, existing.length - this.maxEventsPerProvider);
    }

    this.events.set(key, existing);
  }

  /**
   * Get health status for a specific provider account.
   * A provider is "throttled" if any rate limit event occurred within the throttle window.
   */
  getHealth(accountId: string): ProviderHealth {
    const events = this.events.get(accountId) ?? [];
    const now = Date.now();
    const cutoff = now - this.throttleWindowMs;

    // Filter events that occurred within the throttle window using the timestamp field
    const recentEvents = events.filter((e) => e.timestamp >= cutoff);

    // Find the most recent event timestamp for lastThrottledAt
    let lastThrottledAt: Date | null = null;
    if (events.length > 0) {
      const latestTimestamp = Math.max(...events.map((e) => e.timestamp));
      lastThrottledAt = new Date(latestTimestamp);
    }

    return {
      providerId: accountId,
      status: recentEvents.length > 0 ? 'throttled' : 'healthy',
      recentEvents: events.slice(-10),
      lastThrottledAt,
    };
  }

  /**
   * Get health status for all tracked providers.
   */
  getAllHealth(): ProviderHealth[] {
    const results: ProviderHealth[] = [];
    for (const accountId of this.events.keys()) {
      results.push(this.getHealth(accountId));
    }
    return results;
  }

  /**
   * Check if any provider is currently throttled.
   */
  hasThrottledProviders(): boolean {
    for (const accountId of this.events.keys()) {
      if (this.getHealth(accountId).status === 'throttled') {
        return true;
      }
    }
    return false;
  }

  /**
   * Get the event log for a specific provider (last N events).
   */
  getEventLog(accountId: string): RateLimitEvent[] {
    return [...(this.events.get(accountId) ?? [])];
  }

  /**
   * Clear all tracked events.
   */
  clear(): void {
    this.events.clear();
  }
}
