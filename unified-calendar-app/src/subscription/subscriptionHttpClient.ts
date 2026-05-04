/**
 * Subscription HTTP client factory.
 *
 * Produces a typed HTTP client over the subscription backend that every
 * consumer in `src/subscription/*` can accept: `SubscriptionManager`
 * (post-only), `createStripePaymentService` (get + post), and
 * `pollForFeatureUnlock` (get-only). Returning both verbs from a single
 * factory means the production entry point wires one client for all of
 * them.
 *
 * Security / correctness contract:
 *   1. The base URL must be HTTPS (TLS 1.2+, Requirement 13.1). Any
 *      `http://` URL is rejected at construction time — no "pretend this
 *      was a typo" fallback.
 *   2. Timeouts are clamped into the 5-10 second range used by the rest
 *      of the app (matching `providers/networkSecurity`).
 *   3. A session-token getter is invoked per-request so rotated tokens
 *      are always picked up without rebuilding the client.
 *   4. An injectable Axios instance keeps the factory testable without
 *      installing a real adapter.
 *
 * Security Review 2026-05-02 (pass 3): Finding L4 — residual "wire
 * `subscriptionHttpClient` in the production bootstrap entry point."
 * The bootstrap placeholder now throws on any call; this factory is the
 * canonical production wiring so `bootstrapApp({ ..., subscriptionHttpClient:
 * createSubscriptionHttpClient({ baseUrl, getSessionToken }) })` is a
 * one-liner for the production entry point.
 *
 * Requirements: 10.2, 10.3, 10.5, 13.1
 */

import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';

/** Default request timeout — 8 seconds, same as provider axios instances. */
export const SUBSCRIPTION_DEFAULT_TIMEOUT_MS = 8000;

/** Minimum allowed timeout — matches `networkSecurity.MIN_TIMEOUT_MS`. */
export const SUBSCRIPTION_MIN_TIMEOUT_MS = 5000;

/** Maximum allowed timeout — matches `networkSecurity.MAX_TIMEOUT_MS`. */
export const SUBSCRIPTION_MAX_TIMEOUT_MS = 10000;

/**
 * The combined HTTP surface every subscription consumer uses. Individual
 * modules accept narrower subsets of this (e.g. `SubscriptionManager`
 * only needs `post`) and will happily take an instance of this shape
 * thanks to structural typing.
 */
export interface SubscriptionHttpClient {
  get<T>(url: string, config?: AxiosRequestConfig): Promise<{ data: T }>;
  post<T>(url: string, body: unknown, config?: AxiosRequestConfig): Promise<{ data: T }>;
}

/**
 * Caller-supplied session-token getter. Invoked per-request so a rotated
 * or refreshed session is picked up on the next call with no extra
 * coordination. Returning `null` sends the request without an
 * `Authorization` header (e.g. unauthenticated `/subscriptions/offerings`).
 */
export type SessionTokenGetter = () => Promise<string | null> | string | null;

export interface SubscriptionHttpClientOptions {
  /** Subscription backend base URL. MUST be `https://…`. */
  baseUrl: string;
  /**
   * Async or sync getter returning the current session token. The
   * returned value is sent as `Authorization: Bearer <token>` on every
   * request. `null` means unauthenticated request.
   */
  getSessionToken?: SessionTokenGetter;
  /**
   * Per-request timeout in ms. Clamped to [5000, 10000]. Defaults to
   * 8000, matching the rest of the app.
   */
  timeoutMs?: number;
  /** Optional default headers merged into every request. */
  defaultHeaders?: Record<string, string>;
  /**
   * Optional Axios instance override for tests. Production callers
   * should leave this unset so the factory builds a properly
   * configured instance internally.
   */
  axiosInstance?: AxiosInstance;
}

/**
 * Clamp a timeout value into the allowed 5-10 second range.
 */
function clampTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return SUBSCRIPTION_DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs)) return SUBSCRIPTION_DEFAULT_TIMEOUT_MS;
  return Math.max(
    SUBSCRIPTION_MIN_TIMEOUT_MS,
    Math.min(SUBSCRIPTION_MAX_TIMEOUT_MS, Math.floor(timeoutMs)),
  );
}

/**
 * Validate the base URL is HTTPS. Throws at construction time so the
 * failure is loud and obvious rather than deferred to first request.
 */
function assertHttpsBaseUrl(baseUrl: string): void {
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new Error(
      '[subscriptionHttpClient] baseUrl is required — pass the HTTPS URL of the subscription backend.',
    );
  }
  if (!/^https:\/\//i.test(baseUrl)) {
    throw new Error(
      `[subscriptionHttpClient] baseUrl must use HTTPS (TLS 1.2+, Req 13.1). Received: ${baseUrl}`,
    );
  }
}

/**
 * Normalise an Axios error into a plain `Error` that upstream code can
 * log, so we don't leak raw Axios objects (with circular references and
 * undocumented shape) out of this module.
 */
function normaliseError(err: unknown, method: string, url: string): Error {
  const axiosErr = err as AxiosError | undefined;
  const status = axiosErr?.response?.status;
  const statusText = axiosErr?.response?.statusText;
  if (status !== undefined) {
    return new Error(
      `[subscriptionHttpClient] ${method.toUpperCase()} ${url} failed with ${status}${
        statusText ? ` ${statusText}` : ''
      }`,
    );
  }
  if (err instanceof Error) return err;
  return new Error(`[subscriptionHttpClient] ${method.toUpperCase()} ${url} failed`);
}

/**
 * Build a production `SubscriptionHttpClient`. See file header for the
 * full contract.
 */
export function createSubscriptionHttpClient(
  options: SubscriptionHttpClientOptions,
): SubscriptionHttpClient {
  assertHttpsBaseUrl(options.baseUrl);

  const timeout = clampTimeout(options.timeoutMs);
  const instance: AxiosInstance =
    options.axiosInstance ??
    axios.create({
      baseURL: options.baseUrl,
      timeout,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options.defaultHeaders ?? {}),
      },
    });

  // Auth interceptor: attach the current session token on every request.
  // Using `.use` rather than static headers means a refreshed token is
  // picked up transparently by the next call.
  if (options.getSessionToken) {
    instance.interceptors.request.use(async (config) => {
      try {
        const token = await options.getSessionToken!();
        if (token) {
          config.headers = config.headers ?? {};
          (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
        }
      } catch {
        // Token fetch failures are swallowed so an unauthenticated
        // request is attempted rather than the whole call rejecting
        // before the server gets a chance to respond. If the endpoint
        // requires auth the server will return 401, which the caller
        // already knows how to handle.
      }
      return config;
    });
  }

  // HTTPS enforcement interceptor: catch any caller who tries to sneak
  // an absolute http:// URL into a per-request override.
  instance.interceptors.request.use((config) => {
    const requestedUrl = config.url ?? '';
    if (/^http:\/\//i.test(requestedUrl)) {
      throw new Error(
        `[subscriptionHttpClient] HTTPS required — blocked plain-HTTP request to ${requestedUrl}`,
      );
    }
    return config;
  });

  return {
    async get<T>(url: string, config?: AxiosRequestConfig): Promise<{ data: T }> {
      try {
        const res: AxiosResponse<T> = await instance.get<T>(url, config);
        return { data: res.data };
      } catch (err) {
        throw normaliseError(err, 'get', url);
      }
    },
    async post<T>(
      url: string,
      body: unknown,
      config?: AxiosRequestConfig,
    ): Promise<{ data: T }> {
      try {
        const res: AxiosResponse<T> = await instance.post<T>(url, body, config);
        return { data: res.data };
      } catch (err) {
        throw normaliseError(err, 'post', url);
      }
    },
  };
}
