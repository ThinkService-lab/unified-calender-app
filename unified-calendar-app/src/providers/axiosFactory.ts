/**
 * Creates per-provider Axios instances with auth interceptors.
 * Auto-refreshes tokens on 401 responses.
 * Handles 429 rate limit responses with Retry-After support.
 * Requirements: 1.2, 1.5, 18.2
 */

import axios, { type AxiosInstance, type InternalAxiosRequestConfig, type AxiosError } from 'axios';
import type { OAuthConnector } from './oauthConnector';
import type { RefreshToken } from './types';

/** Default request timeout (8 seconds) */
const DEFAULT_TIMEOUT_MS = 8000;

/** Max retries for 429 responses */
const MAX_429_RETRIES = 3;

/** Default Retry-After delay if header is missing (seconds) */
const DEFAULT_RETRY_AFTER_SECONDS = 5;

/** Callback for rate limit events (logging / sync health) */
export type RateLimitEventHandler = (event: RateLimitEvent) => void;

export interface RateLimitEvent {
  accountId: string;
  baseURL: string;
  retryAfterMs: number;
  retryCount: number;
  url?: string;
  /** Timestamp when the rate limit event occurred (ms since epoch) */
  timestamp: number;
}

export interface AxiosFactoryOptions {
  baseURL: string;
  accountId: string;
  oauthConnector: OAuthConnector;
  /** Info needed to refresh the token */
  refreshTokenInfo: RefreshToken;
  /** Request timeout in ms (default: 8000) */
  timeout?: number;
  /** Optional callback fired on 429 rate limit events (Req 18.5) */
  onRateLimitEvent?: RateLimitEventHandler;
}

/**
 * Parse the Retry-After header value.
 * Supports both seconds (integer) and HTTP-date formats.
 * Returns delay in milliseconds.
 */
export function parseRetryAfter(headerValue: string | undefined | null): number {
  if (!headerValue) {
    return DEFAULT_RETRY_AFTER_SECONDS * 1000;
  }

  // Try parsing as integer (seconds)
  const seconds = parseInt(headerValue, 10);
  if (!isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  // Try parsing as HTTP-date
  const date = new Date(headerValue);
  if (!isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now();
    return Math.max(0, delayMs);
  }

  return DEFAULT_RETRY_AFTER_SECONDS * 1000;
}

/**
 * Create an Axios instance for a specific provider account.
 * - Attaches Bearer token to every request via request interceptor.
 * - Auto-refreshes token on 401 via response interceptor, then retries.
 * - Handles 429 rate limit responses: pauses, respects Retry-After, retries.
 */
export function createProviderAxios(options: AxiosFactoryOptions): AxiosInstance {
  const {
    baseURL,
    accountId,
    oauthConnector,
    refreshTokenInfo,
    timeout = DEFAULT_TIMEOUT_MS,
    onRateLimitEvent,
  } = options;

  const instance = axios.create({
    baseURL,
    timeout,
    headers: { 'Content-Type': 'application/json' },
  });

  /**
   * Security Review 2026-05-01: Finding H4 — Promise-based lock replaces
   * boolean flag to prevent race conditions in concurrent 401 handling.
   * When multiple requests get 401 simultaneously, only one refresh is
   * initiated. All others await the same Promise.
   */
  let refreshPromise: Promise<string> | null = null;

  // Request interceptor: attach access token
  instance.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    const tokens = await oauthConnector.getStoredTokens(accountId);
    if (tokens?.accessToken) {
      config.headers.Authorization = `Bearer ${tokens.accessToken}`;
    }
    return config;
  });

  // Response interceptor: handle 401 (token refresh) and 429 (rate limit)
  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config;
      if (!originalRequest) {
        return Promise.reject(error);
      }

      const status = error.response?.status;

      // ── Handle 429 Rate Limit (Req 18.2) ──────────────────────
      if (status === 429) {
        const retryCount = ((originalRequest as unknown as Record<string, unknown>)._429RetryCount as number) ?? 0;

        if (retryCount >= MAX_429_RETRIES) {
          return Promise.reject(error);
        }

        (originalRequest as unknown as Record<string, unknown>)._429RetryCount = retryCount + 1;

        const retryAfterHeader = error.response?.headers?.['retry-after'] as string | undefined;
        const retryAfterMs = parseRetryAfter(retryAfterHeader);

        // Fire rate limit event callback for logging / sync health
        if (onRateLimitEvent) {
          onRateLimitEvent({
            accountId,
            baseURL,
            retryAfterMs,
            retryCount: retryCount + 1,
            url: originalRequest.url,
            timestamp: Date.now(),
          });
        }

        // Wait for the Retry-After duration, then retry
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
        return instance(originalRequest);
      }

      // ── Handle 401 Unauthorized (token refresh) ───────────────
      if (status !== 401) {
        return Promise.reject(error);
      }

      // Prevent retry loops — only retry once per request
      if ((originalRequest as unknown as Record<string, unknown>)._retried) {
        return Promise.reject(error);
      }
      (originalRequest as unknown as Record<string, unknown>)._retried = true;

      // Promise-based deduplication: if a refresh is already in flight,
      // all concurrent 401 handlers await the same promise.
      if (!refreshPromise) {
        refreshPromise = (async () => {
          try {
            const newAuth = await oauthConnector.refreshAccessToken(refreshTokenInfo);
            await oauthConnector.storeTokens(accountId, newAuth);
            return newAuth.accessToken;
          } finally {
            refreshPromise = null;
          }
        })();
      }

      try {
        const newToken = await refreshPromise;
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return instance(originalRequest);
      } catch (refreshError) {
        return Promise.reject(refreshError);
      }
    },
  );

  return instance;
}
