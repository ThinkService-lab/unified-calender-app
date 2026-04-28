/**
 * Shared rate limiter with request priority support.
 * User-initiated operations get priority over background sync when approaching limits.
 * Requirements: 18.1, 18.4
 */

/** Request priority levels */
export type RequestPriority = 'user' | 'background';

/** Threshold: when usage exceeds this fraction of max, background requests are deferred */
const PRIORITY_THRESHOLD = 0.8;

export interface RateLimiterConfig {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

/**
 * A sliding-window rate limiter with priority support.
 * When usage exceeds 80% of the limit, background-priority requests
 * are deferred until the window resets, preserving capacity for user-initiated operations.
 */
export class PriorityRateLimiter {
  private timestamps: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(config: RateLimiterConfig) {
    this.maxRequests = config.maxRequests;
    this.windowMs = config.windowMs;
  }

  /**
   * Acquire a slot in the rate limiter.
   * @param priority - 'user' for user-initiated, 'background' for sync/polling
   * @throws if background request is deferred due to approaching rate limit
   */
  async acquire(priority: RequestPriority = 'user'): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

    // If approaching the limit and this is a background request, defer it
    if (
      priority === 'background' &&
      this.timestamps.length >= Math.floor(this.maxRequests * PRIORITY_THRESHOLD)
    ) {
      throw new RateLimitDeferredError(
        `Background request deferred: ${this.timestamps.length}/${this.maxRequests} capacity used`,
      );
    }

    // If at the hard limit, wait for the window to open
    if (this.timestamps.length >= this.maxRequests) {
      const oldest = this.timestamps[0];
      const waitMs = this.windowMs - (now - oldest);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      const afterWait = Date.now();
      this.timestamps = this.timestamps.filter((t) => afterWait - t < this.windowMs);
    }

    this.timestamps.push(Date.now());
  }

  /** Current count of requests in the active window */
  get currentCount(): number {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    return this.timestamps.length;
  }

  /** Whether the limiter is approaching the threshold (>80% capacity) */
  get isApproachingLimit(): boolean {
    return this.currentCount >= Math.floor(this.maxRequests * PRIORITY_THRESHOLD);
  }

  /** Whether the limiter is at the hard limit */
  get isAtLimit(): boolean {
    return this.currentCount >= this.maxRequests;
  }

  /** Reset the limiter */
  reset(): void {
    this.timestamps = [];
  }
}

/**
 * Error thrown when a background request is deferred due to rate limit pressure.
 * The sync engine should catch this and retry later.
 */
export class RateLimitDeferredError extends Error {
  readonly isDeferred = true;

  constructor(message: string) {
    super(message);
    this.name = 'RateLimitDeferredError';
  }
}
