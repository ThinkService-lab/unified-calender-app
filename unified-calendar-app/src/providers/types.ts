/**
 * Provider adapter type definitions.
 * Requirements: 1.1, 1.2, 1.5, 13.2
 */

import type { ProviderId } from '../types/models';
import type { FreeBusySlot } from '../types/scheduling';

/** OAuth 2.0 configuration with PKCE support for mobile flows */
export interface OAuthConfig {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** PKCE code verifier (43-128 chars, random) */
  codeVerifier?: string;
  /** PKCE code challenge = base64url(SHA256(codeVerifier)) */
  codeChallenge?: string;
  /** Additional provider-specific parameters */
  extraParams?: Record<string, string>;
}

/** Result of an OAuth authentication or token refresh */
export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  scope?: string;
  idToken?: string;
}

/** Refresh token payload for token renewal */
export interface RefreshToken {
  token: string;
  clientId: string;
  tokenEndpoint: string;
}

/** Raw event data from a provider (pre-normalization) */
export interface RawEventData {
  id?: string;
  icsData?: string;
  providerData?: Record<string, unknown>;
}

/** Calendar metadata from a provider */
export interface Calendar {
  id: string;
  name: string;
  color: string;
  isPrimary: boolean;
  accessRole: 'owner' | 'writer' | 'reader' | 'freeBusyReader';
}

/** Date range for querying events */
export interface DateRange {
  start: Date;
  end: Date;
}

/** Set of changes from incremental sync */
export interface ChangeSet {
  created: RawEventData[];
  updated: RawEventData[];
  deleted: string[];
  nextSyncToken: string;
}

/** Push notification subscription details */
export interface PushSubscription {
  subscriptionId: string;
  resourceUri: string;
  expiresAt: Date;
}

/** The CalendarProviderAdapter interface — all providers implement this */
export interface CalendarProviderAdapter {
  readonly providerId: ProviderId;

  authenticate(config: OAuthConfig): Promise<AuthResult>;
  refreshToken(token: RefreshToken): Promise<AuthResult>;
  revokeAccess(accountId: string): Promise<void>;

  listCalendars(accountId: string): Promise<Calendar[]>;

  listEvents(calendarId: string, range: DateRange): Promise<RawEventData[]>;
  createEvent(calendarId: string, event: RawEventData): Promise<string>;
  updateEvent(calendarId: string, eventId: string, event: RawEventData): Promise<void>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;

  getChanges(calendarId: string, syncToken: string | null): Promise<ChangeSet>;
  setupPushNotification?(calendarId: string, webhookUrl: string): Promise<PushSubscription>;

  getFreeBusy?(calendarId: string, range: DateRange): Promise<FreeBusySlot[]>;
}

/** Secure storage interface for platform-specific credential storage */
export interface SecureStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
