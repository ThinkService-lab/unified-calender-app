/**
 * OAuth 2.0 connector with PKCE support for mobile flows.
 * Requirements: 1.1, 1.2, 1.5
 */

import type { OAuthConfig, AuthResult, RefreshToken, SecureStorage } from './types';

/** PKCE code verifier character set (unreserved URI characters per RFC 7636) */
const PKCE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/**
 * Generate a cryptographically random PKCE code verifier (43-128 chars).
 * Uses rejection sampling to eliminate modulo bias.
 * Security Review 2026-05-01: Finding H1
 */
export function generateCodeVerifier(length: number = 64): string {
  if (length < 43 || length > 128) {
    throw new Error('PKCE code verifier length must be between 43 and 128');
  }

  // Rejection sampling: the largest multiple of charsetLength (66) that fits
  // in a byte is 198 (= 256 - (256 % 66)). Bytes >= 198 are discarded so every
  // accepted byte maps uniformly to the 66-character PKCE charset.
  // Security Review 2026-05-02: Finding M5 — corrected the misleading
  // arithmetic in the previous comment (it said 264/252; actual is 198).
  const charsetLength = PKCE_CHARSET.length; // 66
  const limit = 256 - (256 % charsetLength); // 198 for 66 chars

  const result: string[] = [];
  while (result.length < length) {
    const randomValues = new Uint8Array(length - result.length + 10); // over-allocate slightly
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < randomValues.length && result.length < length; i++) {
      if (randomValues[i] < limit) {
        result.push(PKCE_CHARSET[randomValues[i] % charsetLength]);
      }
      // else: discard biased byte, try next
    }
  }

  return result.join('');
}

/**
 * Generate a PKCE code challenge from a code verifier.
 * challenge = base64url(SHA-256(verifier))
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Base64url encode (no padding, URL-safe characters).
 */
export function base64UrlEncode(buffer: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Storage key helpers */
function tokenKey(accountId: string): string {
  return `oauth_tokens_${accountId}`;
}

/**
 * Persisted shape written to secure storage. Adds an absolute `storedAt`
 * timestamp and a flag for whether the token was recently rejected by
 * the provider, which together let `getTokenExpiryInfo` return an
 * accurate expiry without hitting the network.
 *
 * Security Review 2026-05-02 (pass 3): Finding L6 follow-up — production
 * wiring for `tokenExpiryProvider` requires an absolute deadline, which
 * `AuthResult.expiresIn` (relative seconds) does not provide.
 */
interface PersistedTokens extends AuthResult {
  /** Epoch ms at which `storeTokens` wrote this record. */
  storedAt: number;
  /**
   * Set to true by the refresh path (or by a caller that observed a 401
   * on this account) so the next health-monitor tick forces a fresh
   * network probe instead of trusting the local expiry.
   */
  recentlyRejected?: boolean;
}

/** Parsed info used by the cached token-health checker (L6). */
export interface StoredTokenExpiryInfo {
  /** Absolute epoch ms at which the access token expires. */
  expiresAt: number | null;
  /** Whether the last real network call for this account returned 401. */
  recentlyRejected: boolean;
}

/**
 * OAuthConnector handles the OAuth 2.0 authorization code flow with PKCE,
 * token storage, refresh, and revocation.
 */
export class OAuthConnector {
  constructor(private readonly storage: SecureStorage) {}

  /**
   * Build the authorization URL for the OAuth 2.0 flow.
   * The caller should redirect the user to this URL in a browser/webview.
   * After the user authorizes, the provider redirects back with an authorization code.
   *
   * Returns the URL and the PKCE parameters (codeVerifier must be stored
   * and passed to exchangeCodeForTokens later).
   */
  async buildAuthorizationUrl(config: OAuthConfig): Promise<{
    url: string;
    codeVerifier: string;
    codeChallenge: string;
  }> {
    const codeVerifier = config.codeVerifier ?? generateCodeVerifier();
    const codeChallenge = config.codeChallenge ?? await generateCodeChallenge(codeVerifier);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    // Add any extra params
    if (config.extraParams) {
      for (const [key, value] of Object.entries(config.extraParams)) {
        params.set(key, value);
      }
    }

    return {
      url: `${config.authorizationEndpoint}?${params.toString()}`,
      codeVerifier,
      codeChallenge,
    };
  }

  /**
   * Exchange an authorization code for tokens.
   * The caller is responsible for obtaining the authorization code via
   * the platform's browser/webview redirect flow (see buildAuthorizationUrl).
   */
  async exchangeCodeForTokens(
    code: string,
    config: OAuthConfig,
  ): Promise<AuthResult> {
    const body: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
    };

    if (config.codeVerifier) {
      body.code_verifier = config.codeVerifier;
    }

    const response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OAuth token exchange failed (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    const result: AuthResult = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? '',
      expiresIn: data.expires_in ?? 3600,
      tokenType: data.token_type ?? 'Bearer',
      scope: data.scope,
      idToken: data.id_token,
    };

    return result;
  }

  /**
   * Refresh an expired access token using a refresh token.
   */
  async refreshAccessToken(token: RefreshToken): Promise<AuthResult> {
    const body: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: token.token,
      client_id: token.clientId,
    };

    const response = await fetch(token.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Token refresh failed (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? token.token,
      expiresIn: data.expires_in ?? 3600,
      tokenType: data.token_type ?? 'Bearer',
      scope: data.scope,
      idToken: data.id_token,
    };
  }

  /**
   * Store tokens securely for an account. Stamps the current time so
   * the absolute expiry deadline can be computed later without hitting
   * the provider (used by the token-health monitor's local-expiry
   * short-circuit, Security Review 2026-05-02 Finding L6).
   */
  async storeTokens(accountId: string, result: AuthResult): Promise<void> {
    const persisted: PersistedTokens = {
      ...result,
      storedAt: Date.now(),
      recentlyRejected: false,
    };
    await this.storage.setItem(tokenKey(accountId), JSON.stringify(persisted));
  }

  /**
   * Retrieve stored tokens for an account.
   *
   * Returns the `AuthResult` shape callers have always received. The
   * extra `storedAt` / `recentlyRejected` fields used by
   * `getTokenExpiryInfo` are stripped here so the return type stays
   * backward-compatible.
   */
  async getStoredTokens(accountId: string): Promise<AuthResult | null> {
    const persisted = await this.getPersistedTokens(accountId);
    if (!persisted) return null;
    // Project back to the public AuthResult shape.
    const { storedAt: _storedAt, recentlyRejected: _rr, ...authResult } =
      persisted;
    return authResult;
  }

  /**
   * Retrieve expiry metadata for an account without hitting the
   * provider. Returns `null` when no token is stored or the record
   * cannot be parsed.
   *
   * Used to build the `tokenExpiryProvider` wired into the bootstrap's
   * cached token-health checker (Security Review 2026-05-02 Finding L6
   * follow-up).
   */
  async getTokenExpiryInfo(
    accountId: string,
  ): Promise<StoredTokenExpiryInfo | null> {
    const persisted = await this.getPersistedTokens(accountId);
    if (!persisted) return null;
    const storedAt = typeof persisted.storedAt === 'number' ? persisted.storedAt : null;
    const expiresIn =
      typeof persisted.expiresIn === 'number' && persisted.expiresIn > 0
        ? persisted.expiresIn
        : null;
    const expiresAt =
      storedAt !== null && expiresIn !== null ? storedAt + expiresIn * 1000 : null;
    return {
      expiresAt,
      recentlyRejected: persisted.recentlyRejected === true,
    };
  }

  /**
   * Mark a stored token as recently rejected (e.g. after a 401 from the
   * provider) so the next health-monitor tick forces a fresh probe
   * even if the local expiry still looks valid.
   */
  async markTokenRejected(accountId: string): Promise<void> {
    const persisted = await this.getPersistedTokens(accountId);
    if (!persisted) return;
    persisted.recentlyRejected = true;
    await this.storage.setItem(tokenKey(accountId), JSON.stringify(persisted));
  }

  /**
   * Internal helper — reads and parses the full persisted record.
   */
  private async getPersistedTokens(accountId: string): Promise<PersistedTokens | null> {
    const stored = await this.storage.getItem(tokenKey(accountId));
    if (!stored) return null;
    try {
      return JSON.parse(stored) as PersistedTokens;
    } catch {
      return null;
    }
  }

  /**
   * Clear all stored credentials for an account.
   */
  async clearTokens(accountId: string): Promise<void> {
    await this.storage.removeItem(tokenKey(accountId));
  }
}
