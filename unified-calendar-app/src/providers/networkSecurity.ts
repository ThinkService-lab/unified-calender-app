/**
 * Network security module enforcing TLS, timeouts, and data leak prevention.
 * Requirements: 13.1, 13.3
 *
 * - All Axios instances must use HTTPS (TLS 1.2+)
 * - Timeouts set to 5-10 seconds on all requests
 * - No raw event data sent to third parties (except originating provider)
 * - Per-provider Axios instances with base URLs and auth interceptors
 */

import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { createProviderAxios, type AxiosFactoryOptions } from './axiosFactory';
import type { OAuthConnector } from './oauthConnector';
import type { RefreshToken } from './types';

// ── Provider base URLs ─────────────────────────────────────────────

/** Google Calendar REST API v3 base URL */
export const GOOGLE_CALENDAR_BASE_URL = 'https://www.googleapis.com/calendar/v3';

/** Microsoft Graph API v1.0 base URL */
export const MICROSOFT_GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

// ── Timeout constants ──────────────────────────────────────────────

/** Default request timeout: 8 seconds (within the 5-10s range) */
export const DEFAULT_TIMEOUT_MS = 8000;

/** Minimum allowed timeout: 5 seconds */
export const MIN_TIMEOUT_MS = 5000;

/** Maximum allowed timeout: 10 seconds */
export const MAX_TIMEOUT_MS = 10000;

// ── Allowed provider domains ───────────────────────────────────────

/**
 * Set of allowed provider hostnames. Requests to these domains are
 * permitted to carry full event data. Requests to any other domain
 * will have sensitive event fields stripped.
 *
 * Security Review 2026-05-01: Finding H5 — separated static and dynamic domains.
 */
const STATIC_PROVIDER_DOMAINS: ReadonlySet<string> = new Set([
  'www.googleapis.com',
  'googleapis.com',
  'graph.microsoft.com',
  'caldav.icloud.com',
  'contacts.icloud.com',
  'p01-caldav.icloud.com',
  'p02-caldav.icloud.com',
  'p03-caldav.icloud.com',
  'p04-caldav.icloud.com',
  'p05-caldav.icloud.com',
  'p06-caldav.icloud.com',
]);

/**
 * Dynamic CalDAV domains added at runtime when users connect CalDAV accounts.
 * Separated from static domains for auditability.
 * Security Review 2026-05-01: Finding H5
 */
const dynamicCalDAVDomains: Set<string> = new Set();

/**
 * Domains that should never be added as CalDAV providers.
 * Prevents social engineering attacks where a user is tricked into
 * connecting a non-CalDAV server to exfiltrate event data.
 * Security Review 2026-05-01: Finding H5
 */
const BLOCKED_DOMAIN_PATTERNS: readonly string[] = [
  'google.com',
  'googleapis.com',
  'microsoft.com',
  'live.com',
  'outlook.com',
  'amazon.com',
  'facebook.com',
  'meta.com',
  'twitter.com',
  'github.com',
  'localhost',
];

/**
 * Backward-compatible export: combined view of static + dynamic domains.
 * Tests and the index re-export reference this name.
 */
export const ALLOWED_PROVIDER_DOMAINS: ReadonlySet<string> = new Proxy(
  STATIC_PROVIDER_DOMAINS as Set<string>,
  {
    get(target, prop, receiver) {
      if (prop === 'has') {
        return (value: string) => target.has(value) || dynamicCalDAVDomains.has(value);
      }
      if (prop === 'size') {
        return target.size + dynamicCalDAVDomains.size;
      }
      return Reflect.get(target, prop, receiver);
    },
  },
) as ReadonlySet<string>;

/**
 * Sensitive event data field names that must not leak to third parties.
 * These are stripped from request bodies sent to non-provider endpoints.
 */
export const SENSITIVE_EVENT_FIELDS: ReadonlySet<string> = new Set([
  'title',
  'summary',
  'subject',
  'description',
  'bodyPreview',
  'body',
  'attendees',
  'organizer',
  'location',
  'displayName',
]);

// ── HTTPS enforcement ──────────────────────────────────────────────

/**
 * Validate that a URL uses HTTPS. Throws if the URL uses plain HTTP.
 * Relative URLs (no protocol) are allowed since they use the instance's baseURL.
 */
export function enforceHttps(url: string | undefined, baseURL: string | undefined): void {
  // Resolve the full URL
  const fullUrl = resolveFullUrl(url, baseURL);
  if (!fullUrl) return; // Can't validate without a URL

  // Check for explicit http:// protocol
  if (fullUrl.toLowerCase().startsWith('http://')) {
    throw new Error(
      `HTTPS required: Insecure HTTP request blocked. URL: ${fullUrl}. ` +
      'All network traffic must use TLS 1.2+ (Requirement 13.1).'
    );
  }
}

/**
 * Resolve a potentially relative URL against a base URL.
 */
function resolveFullUrl(url: string | undefined, baseURL: string | undefined): string | null {
  if (!url && !baseURL) return null;

  // If url is absolute, use it directly
  if (url && /^https?:\/\//i.test(url)) {
    return url;
  }

  // If we have a baseURL, combine them
  if (baseURL) {
    if (url) {
      // Remove trailing slash from base and leading slash from path
      const base = baseURL.replace(/\/+$/, '');
      const path = url.replace(/^\/+/, '');
      return `${base}/${path}`;
    }
    return baseURL;
  }

  return url ?? null;
}

// ── Sensitive data stripping ───────────────────────────────────────

/**
 * Check if a hostname belongs to an allowed calendar provider.
 * Checks both static provider domains and dynamic CalDAV domains.
 * Security Review 2026-05-01: Finding H5
 */
export function isAllowedProviderDomain(hostname: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  // Check static domains (exact match)
  if (STATIC_PROVIDER_DOMAINS.has(normalizedHost)) {
    return true;
  }
  // Check dynamic CalDAV domains (exact match)
  if (dynamicCalDAVDomains.has(normalizedHost)) {
    return true;
  }
  // Check if it's a subdomain of a static domain
  for (const allowed of STATIC_PROVIDER_DOMAINS) {
    if (normalizedHost.endsWith(`.${allowed}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Validate that a hostname is a plausible CalDAV server domain.
 * Rejects known non-CalDAV domains and bare TLDs.
 * Security Review 2026-05-01: Finding H5
 */
export function isValidCalDAVDomain(hostname: string): boolean {
  const normalizedHost = hostname.toLowerCase();

  // Must have at least one dot (no bare TLDs or localhost without port)
  if (!normalizedHost.includes('.')) {
    return false;
  }

  // Reject blocked domain patterns
  for (const blocked of BLOCKED_DOMAIN_PATTERNS) {
    if (normalizedHost === blocked || normalizedHost.endsWith(`.${blocked}`)) {
      return false;
    }
  }

  return true;
}

/**
 * Add a custom CalDAV domain to the allowed provider domains set.
 * Validates the domain before adding. Returns true if added, false if rejected.
 * Security Review 2026-05-01: Finding H5
 */
export function addAllowedProviderDomain(hostname: string): boolean {
  const normalizedHost = hostname.toLowerCase();

  // Already in static set — no need to add
  if (STATIC_PROVIDER_DOMAINS.has(normalizedHost)) {
    return true;
  }

  // Validate before adding
  if (!isValidCalDAVDomain(normalizedHost)) {
    return false;
  }

  dynamicCalDAVDomains.add(normalizedHost);
  return true;
}

/**
 * Remove a dynamic CalDAV domain (e.g., when an account is disconnected).
 * Security Review 2026-05-01: Finding H5
 */
export function removeAllowedProviderDomain(hostname: string): void {
  dynamicCalDAVDomains.delete(hostname.toLowerCase());
}

/**
 * Get the current set of dynamic CalDAV domains (for testing/debugging).
 * Security Review 2026-05-01: Finding H5
 */
export function getDynamicDomains(): ReadonlySet<string> {
  return dynamicCalDAVDomains;
}

/**
 * Extract the hostname from a full URL or base URL.
 */
export function extractHostname(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Strip sensitive event data fields from a request body.
 * Returns a sanitized copy — does not mutate the original.
 */
export function stripSensitiveFields(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map(stripSensitiveFields);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (SENSITIVE_EVENT_FIELDS.has(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = stripSensitiveFields(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ── Request interceptor: HTTPS + data leak prevention ──────────────

/**
 * Create a request interceptor that enforces HTTPS and strips sensitive
 * data from requests to non-provider endpoints.
 */
export function createSecurityRequestInterceptor(
  providerBaseURL: string,
): (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig {
  const providerHostname = extractHostname(providerBaseURL);

  return (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
    // 1. Enforce HTTPS
    enforceHttps(config.url, config.baseURL);

    // 2. Check if request is going to a non-provider domain
    const fullUrl = resolveFullUrl(config.url, config.baseURL);
    if (fullUrl) {
      const targetHostname = extractHostname(fullUrl);
      if (targetHostname && !isAllowedProviderDomain(targetHostname)) {
        // Strip sensitive event data from the request body
        if (config.data) {
          config.data = stripSensitiveFields(config.data);
        }
      }
    }

    return config;
  };
}

// ── Per-provider Axios instance factory ────────────────────────────

export interface ProviderAxiosConfig {
  accountId: string;
  oauthConnector: OAuthConnector;
  refreshTokenInfo: RefreshToken;
  /** Optional timeout override (must be 5000-10000ms) */
  timeout?: number;
  /** Optional rate limit event handler */
  onRateLimitEvent?: AxiosFactoryOptions['onRateLimitEvent'];
}

export interface CalDAVAxiosConfig extends ProviderAxiosConfig {
  /** CalDAV server base URL (must be https://) */
  serverUrl: string;
}

/**
 * Validate and clamp a timeout value to the allowed range (5-10 seconds).
 */
export function validateTimeout(timeout: number | undefined): number {
  if (timeout === undefined) return DEFAULT_TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, timeout));
}

/**
 * Create a secure Axios instance for a provider with all security
 * interceptors applied: HTTPS enforcement, auth, data leak prevention.
 */
function createSecureProviderAxios(
  baseURL: string,
  config: ProviderAxiosConfig,
): AxiosInstance {
  // Validate the base URL is HTTPS
  enforceHttps(baseURL, undefined);

  const timeout = validateTimeout(config.timeout);

  const instance = createProviderAxios({
    baseURL,
    accountId: config.accountId,
    oauthConnector: config.oauthConnector,
    refreshTokenInfo: config.refreshTokenInfo,
    timeout,
    onRateLimitEvent: config.onRateLimitEvent,
  });

  // Add security request interceptor (runs before the auth interceptor)
  // We use unshift-like behavior by ejecting and re-adding
  const securityInterceptor = createSecurityRequestInterceptor(baseURL);
  instance.interceptors.request.use(securityInterceptor);

  return instance;
}

/**
 * Create a secure Axios instance for Google Calendar API.
 * Base URL: https://www.googleapis.com/calendar/v3
 */
export function createGoogleAxios(config: ProviderAxiosConfig): AxiosInstance {
  return createSecureProviderAxios(GOOGLE_CALENDAR_BASE_URL, config);
}

/**
 * Create a secure Axios instance for Microsoft Graph API.
 * Base URL: https://graph.microsoft.com/v1.0
 */
export function createMicrosoftGraphAxios(config: ProviderAxiosConfig): AxiosInstance {
  return createSecureProviderAxios(MICROSOFT_GRAPH_BASE_URL, config);
}

/**
 * Create a secure Axios instance for a CalDAV server.
 * Base URL: configurable (must be https://).
 *
 * Security Review 2026-05-02: Finding H9 — the return value of
 * addAllowedProviderDomain is now honored so blocked domains (e.g., a
 * phishing target dressed up as a CalDAV server) fail fast instead of
 * silently producing an instance whose data is always redacted.
 */
export function createCalDAVAxios(config: CalDAVAxiosConfig): AxiosInstance {
  const { serverUrl, ...providerConfig } = config;

  // Validate CalDAV server URL is HTTPS
  if (!serverUrl.toLowerCase().startsWith('https://')) {
    throw new Error(
      `CalDAV server URL must use HTTPS: ${serverUrl}. ` +
      'All network traffic must use TLS 1.2+ (Requirement 13.1).'
    );
  }

  // Dynamically add the CalDAV server domain to allowed providers.
  // Rejection must abort instance creation rather than silently proceed.
  const hostname = extractHostname(serverUrl);
  if (!hostname) {
    throw new Error(
      `Invalid CalDAV server URL: cannot extract hostname from ${serverUrl}`
    );
  }
  const added = addAllowedProviderDomain(hostname);
  if (!added) {
    throw new Error(
      `CalDAV server domain "${hostname}" is not permitted. ` +
      'The domain matches a known non-CalDAV provider or is otherwise invalid.'
    );
  }

  return createSecureProviderAxios(serverUrl, providerConfig);
}

/**
 * Create all per-provider Axios instances for a set of accounts.
 * Returns a map of provider name to configured Axios instance.
 */
export interface AllProviderAxiosConfigs {
  google?: ProviderAxiosConfig;
  microsoft?: ProviderAxiosConfig;
  caldav?: CalDAVAxiosConfig;
}

export interface ProviderAxiosInstances {
  google?: AxiosInstance;
  microsoft?: AxiosInstance;
  caldav?: AxiosInstance;
}

export function createAllProviderAxios(
  configs: AllProviderAxiosConfigs,
): ProviderAxiosInstances {
  const instances: ProviderAxiosInstances = {};

  if (configs.google) {
    instances.google = createGoogleAxios(configs.google);
  }
  if (configs.microsoft) {
    instances.microsoft = createMicrosoftGraphAxios(configs.microsoft);
  }
  if (configs.caldav) {
    instances.caldav = createCalDAVAxios(configs.caldav);
  }

  return instances;
}
