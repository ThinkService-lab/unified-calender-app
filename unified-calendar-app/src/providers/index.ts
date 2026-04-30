/**
 * Provider adapters barrel exports.
 * Requirements: 1.1, 1.2, 1.5, 13.2
 */

// Types
export type {
  OAuthConfig,
  AuthResult,
  RefreshToken,
  RawEventData,
  Calendar,
  DateRange,
  ChangeSet,
  PushSubscription,
  CalendarProviderAdapter,
  SecureStorage,
} from './types';

// OAuth connector
export {
  OAuthConnector,
  generateCodeVerifier,
  generateCodeChallenge,
  base64UrlEncode,
} from './oauthConnector';

// Base adapter
export { BaseCalendarAdapter, type BaseAdapterConfig } from './baseAdapter';

// Axios factory
export {
  createProviderAxios,
  parseRetryAfter,
  type AxiosFactoryOptions,
  type RateLimitEvent,
  type RateLimitEventHandler,
} from './axiosFactory';

// Secure storage (platform-resolved)
export { createSecureStorage } from './secureStorage';

// Google Calendar adapter
export {
  GoogleCalendarAdapter,
  GoogleRateLimiter,
  type GoogleAdapterConfig,
  type BatchRequest,
} from './googleAdapter';

// Microsoft Outlook adapter
export {
  OutlookCalendarAdapter,
  OutlookRateLimiter,
  type OutlookAdapterConfig,
  type OutlookBatchRequest,
} from './outlookAdapter';

// CalDAV adapter (iCloud + generic CalDAV)
export {
  CalDAVAdapter,
  CalDAVRateLimiter,
  type CalDAVAdapterConfig,
} from './caldavAdapter';

// Microsoft Exchange adapter
export {
  ExchangeCalendarAdapter,
  ExchangeRateLimiter,
  type ExchangeAdapterConfig,
  type ExchangeBatchRequest,
} from './exchangeAdapter';

// iCloud adapter (CalDAV with iCloud defaults)
export {
  ICloudCalendarAdapter,
  type ICloudAdapterConfig,
} from './icloudAdapter';

// Token health monitor
export {
  TokenHealthMonitor,
  type TokenHealthMonitorConfig,
  type TokenHealthChecker,
} from './tokenHealthMonitor';

// Priority rate limiter
export {
  PriorityRateLimiter,
  RateLimitDeferredError,
  type RateLimiterConfig,
  type RequestPriority,
} from './rateLimiter';

// Sync health indicator
export {
  SyncHealthIndicator,
  type ProviderHealth,
} from './syncHealthIndicator';

// Network security (TLS enforcement, data leak prevention)
export {
  enforceHttps,
  isAllowedProviderDomain,
  addAllowedProviderDomain,
  extractHostname,
  stripSensitiveFields,
  createSecurityRequestInterceptor,
  createGoogleAxios,
  createMicrosoftGraphAxios,
  createCalDAVAxios,
  createAllProviderAxios,
  validateTimeout,
  GOOGLE_CALENDAR_BASE_URL,
  MICROSOFT_GRAPH_BASE_URL,
  ALLOWED_PROVIDER_DOMAINS,
  SENSITIVE_EVENT_FIELDS,
  DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  type ProviderAxiosConfig,
  type CalDAVAxiosConfig,
  type AllProviderAxiosConfigs,
  type ProviderAxiosInstances,
} from './networkSecurity';
