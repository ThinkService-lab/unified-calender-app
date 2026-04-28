/**
 * OAuth 2.0 connector with PKCE support for mobile flows.
 * Requirements: 1.1, 1.2, 1.5
 */

import type { OAuthConfig, AuthResult, RefreshToken, SecureStorage } from './types';

/** PKCE code verifier character set (unreserved URI characters per RFC 7636) */
const PKCE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/**
 * Generate a cryptographically random PKCE code verifier (43-128 chars).
 */
export function generateCodeVerifier(length: number = 64): string {
  if (length < 43 || length > 128) {
    throw new Error('PKCE code verifier length must be between 43 and 128');
  }
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  return Array.from(randomValues)
    .map((v) => PKCE_CHARSET[v % PKCE_CHARSET.length])
    .join('');
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
   * Store tokens securely for an account.
   */
  async storeTokens(accountId: string, result: AuthResult): Promise<void> {
    await this.storage.setItem(tokenKey(accountId), JSON.stringify(result));
  }

  /**
   * Retrieve stored tokens for an account.
   */
  async getStoredTokens(accountId: string): Promise<AuthResult | null> {
    const stored = await this.storage.getItem(tokenKey(accountId));
    if (!stored) return null;
    try {
      return JSON.parse(stored) as AuthResult;
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
