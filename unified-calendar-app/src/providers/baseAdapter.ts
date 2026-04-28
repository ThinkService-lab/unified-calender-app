/**
 * Abstract base class implementing common CalendarProviderAdapter logic.
 * Concrete adapters (Google, Outlook, CalDAV, Exchange) extend this.
 * Requirements: 1.1, 1.2, 1.5, 13.2
 */

import type { ProviderId } from '../types/models';
import type { FreeBusySlot } from '../types/scheduling';
import type {
  CalendarProviderAdapter,
  OAuthConfig,
  AuthResult,
  RefreshToken,
  Calendar,
  RawEventData,
  DateRange,
  ChangeSet,
  PushSubscription,
  SecureStorage,
} from './types';
import { OAuthConnector, generateCodeVerifier, generateCodeChallenge } from './oauthConnector';
import { createProviderAxios, type AxiosFactoryOptions } from './axiosFactory';
import type { AxiosInstance } from 'axios';

export interface BaseAdapterConfig {
  providerId: ProviderId;
  baseURL: string;
  storage: SecureStorage;
}

/**
 * Abstract base adapter providing shared OAuth, token management,
 * and Axios instance creation. Subclasses implement provider-specific
 * API calls for calendars, events, sync, and push.
 */
export abstract class BaseCalendarAdapter implements CalendarProviderAdapter {
  readonly providerId: ProviderId;
  protected readonly baseURL: string;
  protected readonly oauthConnector: OAuthConnector;
  protected readonly storage: SecureStorage;

  constructor(config: BaseAdapterConfig) {
    this.providerId = config.providerId;
    this.baseURL = config.baseURL;
    this.storage = config.storage;
    this.oauthConnector = new OAuthConnector(config.storage);
  }

  /**
   * Authenticate using OAuth 2.0 with PKCE.
   * Generates PKCE parameters if not provided, exchanges the authorization
   * code for tokens, and stores them securely.
   *
   * Note: The actual browser redirect to obtain the authorization code
   * is handled by the platform UI layer. This method expects the
   * authorization code to be available in config.extraParams.code.
   */
  async authenticate(config: OAuthConfig): Promise<AuthResult> {
    let oauthConfig = { ...config };

    // Generate PKCE parameters if not already provided
    if (!oauthConfig.codeVerifier) {
      oauthConfig.codeVerifier = generateCodeVerifier();
      oauthConfig.codeChallenge = await generateCodeChallenge(oauthConfig.codeVerifier);
    } else if (!oauthConfig.codeChallenge) {
      oauthConfig.codeChallenge = await generateCodeChallenge(oauthConfig.codeVerifier);
    }

    const code = oauthConfig.extraParams?.code;
    if (!code) {
      throw new Error('Authorization code is required in config.extraParams.code');
    }

    const result = await this.oauthConnector.exchangeCodeForTokens(code, oauthConfig);

    // Store tokens using the provider ID as a namespace
    const accountId = oauthConfig.extraParams?.accountId ?? `${this.providerId}_default`;
    await this.oauthConnector.storeTokens(accountId, result);

    return result;
  }

  /**
   * Refresh an expired access token.
   */
  async refreshToken(token: RefreshToken): Promise<AuthResult> {
    const result = await this.oauthConnector.refreshAccessToken(token);
    return result;
  }

  /**
   * Revoke access: call the provider's revocation endpoint (if available),
   * then clear all stored credentials for the account.
   * Fires `onAccessRevoked` callback if set, so the caller (e.g., account manager)
   * can update the account status to 'revoked' in the database.
   */
  async revokeAccess(accountId: string): Promise<void> {
    // Attempt server-side token revocation before clearing local tokens
    const storedTokens = await this.oauthConnector.getStoredTokens(accountId);
    if (storedTokens?.accessToken) {
      try {
        await this.revokeTokenServerSide(storedTokens.accessToken);
      } catch {
        // Server-side revocation is best-effort — always clear local tokens
      }
    }
    await this.oauthConnector.clearTokens(accountId);

    // Notify caller so they can update account status in the database
    if (this.onAccessRevoked) {
      this.onAccessRevoked(accountId);
    }
  }

  /**
   * Optional callback fired after revokeAccess completes.
   * The caller should use this to update the CalendarAccount.status to 'revoked'
   * in the local database.
   */
  onAccessRevoked: ((accountId: string) => void) | null = null;

  /**
   * Attempt to revoke the token on the provider's server.
   * Subclasses can override this with provider-specific revocation endpoints.
   * Default implementation is a no-op (not all providers support revocation).
   */
  protected async revokeTokenServerSide(_accessToken: string): Promise<void> {
    // Default: no-op. Subclasses override for providers that support revocation.
  }

  /**
   * Create an authenticated Axios instance for a specific account.
   * Subclasses use this to make provider API calls.
   */
  protected createAxiosInstance(
    accountId: string,
    refreshTokenInfo: RefreshToken,
  ): AxiosInstance {
    const options: AxiosFactoryOptions = {
      baseURL: this.baseURL,
      accountId,
      oauthConnector: this.oauthConnector,
      refreshTokenInfo,
    };
    return createProviderAxios(options);
  }

  // Abstract methods — subclasses must implement provider-specific logic
  abstract listCalendars(accountId: string): Promise<Calendar[]>;
  abstract listEvents(calendarId: string, range: DateRange): Promise<RawEventData[]>;
  abstract createEvent(calendarId: string, event: RawEventData): Promise<string>;
  abstract updateEvent(calendarId: string, eventId: string, event: RawEventData): Promise<void>;
  abstract deleteEvent(calendarId: string, eventId: string): Promise<void>;
  abstract getChanges(calendarId: string, syncToken: string | null): Promise<ChangeSet>;

  // Optional methods — subclasses override if supported
  async setupPushNotification?(calendarId: string, webhookUrl: string): Promise<PushSubscription>;
  async getFreeBusy?(calendarId: string, range: DateRange): Promise<FreeBusySlot[]>;
}
