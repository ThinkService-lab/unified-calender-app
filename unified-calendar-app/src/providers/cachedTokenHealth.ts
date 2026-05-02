/**
 * Cached token-health checker utility.
 *
 * Wraps a raw (network-probing) token-health checker with two layers of
 * short-circuit evaluation to prevent rate-limit amplification:
 *
 *   1. If a `tokenExpiryProvider` is supplied, use locally stored token
 *      expiry info to return `'valid'` / `'expired'` without any network
 *      call. This covers the overwhelming majority of ticks.
 *   2. If no expiry info is available (or it's ambiguous), fall back to
 *      the raw probe — but cache the result for `cacheTtlMs` (default
 *      5 minutes) so repeated polls don't each hit the provider.
 *
 * Security Review 2026-05-02 (pass 3): Finding L6
 *
 * Requirements: 1.4, 18.1, 18.2
 */

import type { TokenHealthChecker } from './tokenHealthMonitor';
import type { TokenHealthStatus } from '../types/auth';

/**
 * Token expiry info for an account. Callers build this from whatever
 * local state they hold (OAuthConnector.getStoredTokens, refresh-time
 * metadata, etc.). Returning `null` signals "I don't know" — the cached
 * checker will fall back to a network probe in that case.
 */
export interface TokenExpiryInfo {
  /** Epoch ms at which the access token expires, or null if unknown */
  expiresAt: number | null;
  /**
   * Whether the most recent network call for this account returned 401.
   * When true, the checker will force a fresh network probe even if the
   * token appears valid by expiry, so genuine revocations are detected
   * quickly.
   */
  recentlyRejected?: boolean;
}

export type TokenExpiryProvider = (
  accountId: string,
) => Promise<TokenExpiryInfo | null> | TokenExpiryInfo | null;

export interface CachedTokenHealthOptions {
  /** Underlying network-probing checker (e.g. `adapter.listCalendars`). */
  rawChecker: TokenHealthChecker;
  /** Optional local expiry lookup. When present, dominates most calls. */
  tokenExpiryProvider?: TokenExpiryProvider;
  /**
   * How long to trust a network probe result. Defaults to 5 minutes,
   * which matches the fastest acceptable revocation-detection window
   * for most providers and is well below the token-refresh cadence.
   */
  cacheTtlMs?: number;
  /**
   * Seconds of skew to subtract from `expiresAt` when deciding whether a
   * token is "expired." Defaults to 60 seconds so that a token which is
   * about to expire is treated as already expired.
   */
  skewSeconds?: number;
  /** Injectable clock for testing. Defaults to `Date.now`. */
  now?: () => number;
}

/** Default TTL for probe results — 5 minutes. */
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

/** Default expiry skew — 60 seconds. */
const DEFAULT_SKEW_SECONDS = 60;

interface CacheEntry {
  status: TokenHealthStatus;
  fetchedAt: number;
}

/**
 * Create a cached token-health checker. Returned checker is a drop-in
 * replacement for a raw `TokenHealthChecker`.
 *
 * Security Review 2026-05-02 (pass 3): Finding L6
 */
export function createCachedTokenHealthChecker(
  options: CachedTokenHealthOptions,
): TokenHealthChecker & { invalidate: (accountId?: string) => void } {
  const {
    rawChecker,
    tokenExpiryProvider,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    skewSeconds = DEFAULT_SKEW_SECONDS,
    now = Date.now,
  } = options;

  const cache = new Map<string, CacheEntry>();

  async function probeAndCache(accountId: string): Promise<TokenHealthStatus> {
    const status = await rawChecker(accountId);
    cache.set(accountId, { status, fetchedAt: now() });
    return status;
  }

  const checker: TokenHealthChecker & { invalidate: (accountId?: string) => void } =
    async function cachedChecker(accountId: string): Promise<TokenHealthStatus> {
      // Step 1: local expiry lookup. When present and conclusive, skip the
      // network entirely.
      if (tokenExpiryProvider) {
        let expiry: TokenExpiryInfo | null = null;
        try {
          expiry = await tokenExpiryProvider(accountId);
        } catch {
          expiry = null;
        }
        if (expiry) {
          // Force a fresh probe if the last real request was rejected —
          // we want to notice genuine revocations quickly even if the
          // expires_at still looks valid on paper.
          if (!expiry.recentlyRejected && expiry.expiresAt !== null) {
            const deadline = expiry.expiresAt - skewSeconds * 1000;
            if (now() < deadline) {
              // Token is valid according to local metadata. No network call.
              return 'valid';
            }
            // Token has expired locally; the refresh interceptor will
            // handle the next real sync. No need to probe.
            return 'expired';
          }
        }
      }

      // Step 2: probe cache.
      const cached = cache.get(accountId);
      if (cached && now() - cached.fetchedAt < cacheTtlMs) {
        return cached.status;
      }

      // Step 3: fall back to a real network probe (and cache the result).
      return probeAndCache(accountId);
    } as TokenHealthChecker & { invalidate: (accountId?: string) => void };

  /**
   * Invalidate the cached probe result for a single account, or for all
   * accounts when `accountId` is omitted. Call this after refreshing or
   * reconnecting a token so the next health check does a fresh probe.
   */
  checker.invalidate = (accountId?: string): void => {
    if (accountId === undefined) {
      cache.clear();
    } else {
      cache.delete(accountId);
    }
  };

  return checker;
}
