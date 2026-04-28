/**
 * Comprehensive rate limit manager for provider API calls.
 * Enforces per-provider rate limits, handles 429 responses with Retry-After,
 * implements exponential backoff with jitter, prioritizes user-initiated
 * operations, logs rate limit events, and exposes sync health status.
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6
 */

import type { ProviderId } from '../types/models';

// ── Types ──

/** Priority for rate-limited operations */
export type OperationPriority = 'user' | 'background';

/** Health status for a provider account */
export type ProviderHealthStatus = 'healthy' | 'degraded' | 'rate-limited' | 'error';

/** Per-provider rate limit configuration */
export interface ProviderRateLimitConfig {
  /** Max requests allowed in the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Default polling interval in milliseconds */
  defaultPollingIntervalMs: number;
}

/** Backoff configuration */
export interface BackoffConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  jitterFactor: number;
}

/** A logged rate limit event */
export interface RateLimitLogEntry {
  accountId: string;
  providerId: ProviderId;
  timestamp: number;
  retryAfterMs: number;
  statusCode: number;
  url?: string;
}

/** Health snapshot for a provider account */
export interface AccountHealthSnapshot {
  accountId: string;
  providerId: ProviderId;
  status: ProviderHealthStatus;
  currentRequestCount: number;
  maxRequests: number;
  windowMs: number;
  consecutive429Count: number;
  currentPollingIntervalMs: number;
  lastRateLimitedAt: number | null;
  recentEvents: RateLimitLogEntry[];
}

/** Result of attempting to execute through the rate limiter */
export interface RateLimitAcquireResult {
  allowed: boolean;
  waitMs: number;
  reason?: string;
}

/** Configuration for the RateLimitManager */
export interface RateLimitManagerConfig {
  /** Override default provider configs */
  providerConfigs?: Partial<Record<ProviderId, ProviderRateLimitConfig>>;
  /** Override default backoff config */
  backoffConfig?: Partial<BackoffConfig>;
  /** Max log entries to keep per account */
  maxLogEntriesPerAccount?: number;
  /** Consecutive 429 threshold to trigger polling interval increase */
  persistentRateLimitThreshold?: number;
  /** Multiplier for polling interval when persistently rate-limited */
  pollingIntervalMultiplier?: number;
  /** Callback for rate limit events (for external logging) */
  onRateLimitEvent?: (entry: RateLimitLogEntry) => void;
}

// ── Default configurations ──

/** Default per-provider rate limit configs (Req 18.1) */
const DEFAULT_PROVIDER_CONFIGS: Record<ProviderId, ProviderRateLimitConfig> = {
  google: {
    maxRequests: 100,
    windowMs: 100_000, // 100 seconds per user
    defaultPollingIntervalMs: 300_000,
  },
  outlook: {
    maxRequests: 10_000,
    windowMs: 600_000, // 10 minutes per app
    defaultPollingIntervalMs: 300_000,
  },
  icloud: {
    maxRequests: 60,
    windowMs: 300_000, // polling ≤ 5 min intervals
    defaultPollingIntervalMs: 300_000,
  },
  exchange: {
    maxRequests: 10_000,
    windowMs: 600_000,
    defaultPollingIntervalMs: 300_000,
  },
  caldav: {
    maxRequests: 60,
    windowMs: 300_000, // polling ≤ 5 min intervals
    defaultPollingIntervalMs: 300_000,
  },
};

/** Default backoff config (Req 18.2) */
const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  maxRetries: 5,
  initialDelayMs: 1_000,
  maxDelayMs: 60_000,
  multiplier: 2,
  jitterFactor: 0.1,
};

/** Threshold: when usage exceeds this fraction, background requests are deferred (Req 18.4) */
const PRIORITY_THRESHOLD = 0.8;

/** Default consecutive 429 threshold for persistent rate limiting (Req 18.6) */
const DEFAULT_PERSISTENT_THRESHOLD = 3;

/** Default polling interval multiplier when persistently rate-limited */
const DEFAULT_POLLING_MULTIPLIER = 2;

/** Max log entries per account */
const DEFAULT_MAX_LOG_ENTRIES = 50;

// ── Internal per-account state ──

interface AccountState {
  providerId: ProviderId;
  timestamps: number[];
  consecutive429Count: number;
  currentPollingIntervalMs: number;
  lastRateLimitedAt: number | null;
  isPaused: boolean;
  pausedUntil: number;
  logEntries: RateLimitLogEntry[];
}

// ── Rate Limit Manager ──

export interface RateLimitManager {
  /**
   * Register a provider account for rate limiting.
   */
  registerAccount(accountId: string, providerId: ProviderId): void;

  /**
   * Try to acquire a rate limit slot for a request.
   * Returns whether the request is allowed and how long to wait if not.
   */
  tryAcquire(accountId: string, priority: OperationPriority): RateLimitAcquireResult;

  /**
   * Record a request being made (call after successful acquire).
   */
  recordRequest(accountId: string): void;

  /**
   * Handle a 429 response from a provider.
   * Pauses requests, respects Retry-After, logs the event.
   */
  handle429(accountId: string, retryAfterMs: number, url?: string): void;

  /**
   * Calculate backoff delay for a given retry attempt.
   */
  calculateBackoff(retryCount: number): number;

  /**
   * Execute an async operation with rate limiting, retry, and backoff.
   * This is the main middleware wrapper for provider adapter calls.
   */
  executeWithRateLimit<T>(
    accountId: string,
    priority: OperationPriority,
    operation: () => Promise<T>,
  ): Promise<T>;

  /**
   * Get health snapshot for a specific account.
   */
  getAccountHealth(accountId: string): AccountHealthSnapshot | null;

  /**
   * Get health snapshots for all registered accounts.
   */
  getAllHealth(): AccountHealthSnapshot[];

  /**
   * Get the current effective polling interval for an account.
   * Increases when persistently rate-limited (Req 18.6).
   */
  getPollingInterval(accountId: string): number;

  /**
   * Get rate limit log entries for an account.
   */
  getLogEntries(accountId: string): RateLimitLogEntry[];

  /**
   * Reset state for an account (e.g., after successful recovery).
   */
  resetAccount(accountId: string): void;

  /**
   * Clear all state.
   */
  clear(): void;
}

/**
 * Create a RateLimitManager instance.
 */
export function createRateLimitManager(config?: RateLimitManagerConfig): RateLimitManager {
  const providerConfigs: Record<ProviderId, ProviderRateLimitConfig> = {
    ...DEFAULT_PROVIDER_CONFIGS,
    ...config?.providerConfigs,
  };

  const backoffConfig: BackoffConfig = {
    ...DEFAULT_BACKOFF_CONFIG,
    ...config?.backoffConfig,
  };

  const maxLogEntries = config?.maxLogEntriesPerAccount ?? DEFAULT_MAX_LOG_ENTRIES;
  const persistentThreshold = config?.persistentRateLimitThreshold ?? DEFAULT_PERSISTENT_THRESHOLD;
  const pollingMultiplier = config?.pollingIntervalMultiplier ?? DEFAULT_POLLING_MULTIPLIER;
  const onRateLimitEvent = config?.onRateLimitEvent;

  const accounts = new Map<string, AccountState>();

  function getAccount(accountId: string): AccountState | undefined {
    return accounts.get(accountId);
  }

  function getProviderConfig(providerId: ProviderId): ProviderRateLimitConfig {
    return providerConfigs[providerId];
  }

  function pruneTimestamps(state: AccountState, now: number): void {
    const cfg = getProviderConfig(state.providerId);
    state.timestamps = state.timestamps.filter((t) => now - t < cfg.windowMs);
  }

  function addLogEntry(state: AccountState, entry: RateLimitLogEntry): void {
    state.logEntries.push(entry);
    if (state.logEntries.length > maxLogEntries) {
      state.logEntries.splice(0, state.logEntries.length - maxLogEntries);
    }
  }

  function computeStatus(state: AccountState): ProviderHealthStatus {
    const now = Date.now();
    pruneTimestamps(state, now);
    const cfg = getProviderConfig(state.providerId);

    if (state.isPaused && now < state.pausedUntil) {
      return 'rate-limited';
    }

    if (state.consecutive429Count >= persistentThreshold) {
      return 'error';
    }

    const usage = state.timestamps.length / cfg.maxRequests;
    if (usage >= PRIORITY_THRESHOLD) {
      return 'degraded';
    }

    return 'healthy';
  }

  // ── Public interface ──

  const manager: RateLimitManager = {
    registerAccount(accountId: string, providerId: ProviderId): void {
      if (accounts.has(accountId)) return;
      const cfg = getProviderConfig(providerId);
      accounts.set(accountId, {
        providerId,
        timestamps: [],
        consecutive429Count: 0,
        currentPollingIntervalMs: cfg.defaultPollingIntervalMs,
        lastRateLimitedAt: null,
        isPaused: false,
        pausedUntil: 0,
        logEntries: [],
      });
    },

    tryAcquire(accountId: string, priority: OperationPriority): RateLimitAcquireResult {
      const state = getAccount(accountId);
      if (!state) {
        return { allowed: true, waitMs: 0 };
      }

      const now = Date.now();
      pruneTimestamps(state, now);
      const cfg = getProviderConfig(state.providerId);

      // If paused due to 429, check if pause has expired
      if (state.isPaused && now < state.pausedUntil) {
        return {
          allowed: false,
          waitMs: state.pausedUntil - now,
          reason: 'Provider is paused due to rate limiting (429 response)',
        };
      }

      // Unpause if pause has expired
      if (state.isPaused && now >= state.pausedUntil) {
        state.isPaused = false;
      }

      // Priority check: defer background requests when approaching limit (Req 18.4)
      if (
        priority === 'background' &&
        state.timestamps.length >= Math.floor(cfg.maxRequests * PRIORITY_THRESHOLD)
      ) {
        return {
          allowed: false,
          waitMs: 0,
          reason: 'Background request deferred: approaching rate limit, reserving capacity for user operations',
        };
      }

      // Hard limit check
      if (state.timestamps.length >= cfg.maxRequests) {
        const oldest = state.timestamps[0];
        const waitMs = cfg.windowMs - (now - oldest);
        return {
          allowed: false,
          waitMs: Math.max(0, waitMs),
          reason: 'Rate limit reached, waiting for window to reset',
        };
      }

      return { allowed: true, waitMs: 0 };
    },

    recordRequest(accountId: string): void {
      const state = getAccount(accountId);
      if (!state) return;
      state.timestamps.push(Date.now());
    },

    handle429(accountId: string, retryAfterMs: number, url?: string): void {
      const state = getAccount(accountId);
      if (!state) return;

      const now = Date.now();

      // Pause requests for the Retry-After duration (Req 18.2)
      state.isPaused = true;
      state.pausedUntil = now + retryAfterMs;
      state.consecutive429Count++;
      state.lastRateLimitedAt = now;

      // Increase polling interval if persistently rate-limited (Req 18.6)
      if (state.consecutive429Count >= persistentThreshold) {
        // Cap at 1 hour to avoid unbounded growth
        const MAX_POLLING_INTERVAL_MS = 3_600_000;
        state.currentPollingIntervalMs = Math.min(
          state.currentPollingIntervalMs * pollingMultiplier,
          MAX_POLLING_INTERVAL_MS,
        );
      }

      // Log the event (Req 18.5)
      const entry: RateLimitLogEntry = {
        accountId,
        providerId: state.providerId,
        timestamp: now,
        retryAfterMs,
        statusCode: 429,
        url,
      };
      addLogEntry(state, entry);

      // Fire external callback
      if (onRateLimitEvent) {
        onRateLimitEvent(entry);
      }
    },

    calculateBackoff(retryCount: number): number {
      const baseDelay = Math.min(
        backoffConfig.initialDelayMs * Math.pow(backoffConfig.multiplier, retryCount),
        backoffConfig.maxDelayMs,
      );
      const jitter = baseDelay * backoffConfig.jitterFactor * (Math.random() * 2 - 1);
      return Math.max(0, Math.round(baseDelay + jitter));
    },

    async executeWithRateLimit<T>(
      accountId: string,
      priority: OperationPriority,
      operation: () => Promise<T>,
    ): Promise<T> {
      let lastError: unknown;

      for (let attempt = 0; attempt <= backoffConfig.maxRetries; attempt++) {
        // Check rate limit before executing
        const acquireResult = manager.tryAcquire(accountId, priority);

        if (!acquireResult.allowed) {
          if (acquireResult.waitMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, acquireResult.waitMs));
            // Re-check after waiting
            const recheck = manager.tryAcquire(accountId, priority);
            if (!recheck.allowed) {
              throw new RateLimitExceededError(
                acquireResult.reason ?? 'Rate limit exceeded',
                accountId,
              );
            }
          } else {
            // Background deferred — don't retry, just throw
            throw new RateLimitDeferredError(
              acquireResult.reason ?? 'Request deferred due to rate limit pressure',
              accountId,
            );
          }
        }

        // Record the request and execute
        manager.recordRequest(accountId);

        try {
          const result = await operation();

          // Success — reset consecutive 429 count
          const state = getAccount(accountId);
          if (state) {
            state.consecutive429Count = 0;
          }

          return result;
        } catch (error: unknown) {
          lastError = error;

          // Check if it's a 429 response
          if (is429Error(error)) {
            const retryAfterMs = extractRetryAfterMs(error);
            manager.handle429(accountId, retryAfterMs, extractUrl(error));

            if (attempt < backoffConfig.maxRetries) {
              // Wait for Retry-After + backoff
              const backoffDelay = manager.calculateBackoff(attempt);
              const totalWait = Math.max(retryAfterMs, backoffDelay);
              await new Promise((resolve) => setTimeout(resolve, totalWait));
              continue;
            }
          } else if (attempt < backoffConfig.maxRetries) {
            // Non-429 error — apply backoff and retry
            const backoffDelay = manager.calculateBackoff(attempt);
            await new Promise((resolve) => setTimeout(resolve, backoffDelay));
            continue;
          }

          throw error;
        }
      }

      throw lastError;
    },

    getAccountHealth(accountId: string): AccountHealthSnapshot | null {
      const state = getAccount(accountId);
      if (!state) return null;

      const now = Date.now();
      pruneTimestamps(state, now);
      const cfg = getProviderConfig(state.providerId);

      return {
        accountId,
        providerId: state.providerId,
        status: computeStatus(state),
        currentRequestCount: state.timestamps.length,
        maxRequests: cfg.maxRequests,
        windowMs: cfg.windowMs,
        consecutive429Count: state.consecutive429Count,
        currentPollingIntervalMs: state.currentPollingIntervalMs,
        lastRateLimitedAt: state.lastRateLimitedAt,
        recentEvents: state.logEntries.slice(-10),
      };
    },

    getAllHealth(): AccountHealthSnapshot[] {
      const results: AccountHealthSnapshot[] = [];
      for (const accountId of accounts.keys()) {
        const health = manager.getAccountHealth(accountId);
        if (health) results.push(health);
      }
      return results;
    },

    getPollingInterval(accountId: string): number {
      const state = getAccount(accountId);
      if (!state) return DEFAULT_PROVIDER_CONFIGS.caldav.defaultPollingIntervalMs;
      return state.currentPollingIntervalMs;
    },

    getLogEntries(accountId: string): RateLimitLogEntry[] {
      const state = getAccount(accountId);
      if (!state) return [];
      return [...state.logEntries];
    },

    resetAccount(accountId: string): void {
      const state = getAccount(accountId);
      if (!state) return;
      const cfg = getProviderConfig(state.providerId);
      state.timestamps = [];
      state.consecutive429Count = 0;
      state.currentPollingIntervalMs = cfg.defaultPollingIntervalMs;
      state.lastRateLimitedAt = null;
      state.isPaused = false;
      state.pausedUntil = 0;
      state.logEntries = [];
    },

    clear(): void {
      accounts.clear();
    },
  };

  return manager;
}

// ── Error classes ──

/** Thrown when a request is blocked because the rate limit is exceeded */
export class RateLimitExceededError extends Error {
  readonly accountId: string;
  constructor(message: string, accountId: string) {
    super(message);
    this.name = 'RateLimitExceededError';
    this.accountId = accountId;
  }
}

/** Thrown when a background request is deferred to preserve capacity for user ops */
export class RateLimitDeferredError extends Error {
  readonly accountId: string;
  readonly isDeferred = true;
  constructor(message: string, accountId: string) {
    super(message);
    this.name = 'RateLimitDeferredError';
    this.accountId = accountId;
  }
}

// ── Helpers for detecting 429 errors from Axios ──

function is429Error(error: unknown): boolean {
  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>;
    // Axios error shape
    if (e.response && typeof e.response === 'object') {
      const resp = e.response as Record<string, unknown>;
      return resp.status === 429;
    }
    // Direct status property
    if (e.status === 429 || e.statusCode === 429) return true;
  }
  return false;
}

function extractRetryAfterMs(error: unknown): number {
  const DEFAULT_RETRY_AFTER_MS = 5_000;
  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>;
    if (e.response && typeof e.response === 'object') {
      const resp = e.response as Record<string, unknown>;
      if (resp.headers && typeof resp.headers === 'object') {
        const headers = resp.headers as Record<string, string>;
        const retryAfter = headers['retry-after'];
        if (retryAfter) {
          const seconds = parseInt(retryAfter, 10);
          if (!isNaN(seconds) && seconds >= 0) return seconds * 1000;
          const date = new Date(retryAfter);
          if (!isNaN(date.getTime())) return Math.max(0, date.getTime() - Date.now());
        }
      }
    }
  }
  return DEFAULT_RETRY_AFTER_MS;
}

function extractUrl(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>;
    if (e.config && typeof e.config === 'object') {
      return (e.config as Record<string, unknown>).url as string | undefined;
    }
  }
  return undefined;
}
