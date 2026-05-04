/**
 * Unit tests for OAuthConnector and PKCE utilities.
 * Requirements: 1.1, 1.2, 1.5
 */

import {
  generateCodeVerifier,
  generateCodeChallenge,
  base64UrlEncode,
  OAuthConnector,
} from '../oauthConnector';
import type { SecureStorage, AuthResult, RefreshToken } from '../types';

/** In-memory SecureStorage for testing */
function createMockStorage(): SecureStorage {
  const store = new Map<string, string>();
  return {
    async getItem(key: string) { return store.get(key) ?? null; },
    async setItem(key: string, value: string) { store.set(key, value); },
    async removeItem(key: string) { store.delete(key); },
  };
}

describe('PKCE utilities', () => {
  describe('generateCodeVerifier', () => {
    it('should generate a verifier of default length 64', () => {
      const verifier = generateCodeVerifier();
      expect(verifier.length).toBe(64);
    });

    it('should generate a verifier of specified length', () => {
      const verifier = generateCodeVerifier(43);
      expect(verifier.length).toBe(43);
      const verifier2 = generateCodeVerifier(128);
      expect(verifier2.length).toBe(128);
    });

    it('should throw for length < 43', () => {
      expect(() => generateCodeVerifier(42)).toThrow('between 43 and 128');
    });

    it('should throw for length > 128', () => {
      expect(() => generateCodeVerifier(129)).toThrow('between 43 and 128');
    });

    it('should only contain unreserved URI characters', () => {
      const verifier = generateCodeVerifier(128);
      expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
    });

    it('should generate unique verifiers', () => {
      const v1 = generateCodeVerifier();
      const v2 = generateCodeVerifier();
      expect(v1).not.toBe(v2);
    });
  });

  describe('generateCodeChallenge', () => {
    it('should produce a base64url-encoded SHA-256 hash', async () => {
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const challenge = await generateCodeChallenge(verifier);
      // base64url encoded, no padding
      expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
      expect(challenge).not.toContain('=');
      expect(challenge).not.toContain('+');
      expect(challenge).not.toContain('/');
    });

    it('should produce consistent output for same input', async () => {
      const verifier = generateCodeVerifier();
      const c1 = await generateCodeChallenge(verifier);
      const c2 = await generateCodeChallenge(verifier);
      expect(c1).toBe(c2);
    });

    it('should produce different output for different input', async () => {
      const c1 = await generateCodeChallenge('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      const c2 = await generateCodeChallenge('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
      expect(c1).not.toBe(c2);
    });
  });

  describe('base64UrlEncode', () => {
    it('should encode without padding', () => {
      const data = new Uint8Array([1, 2, 3]);
      const encoded = base64UrlEncode(data);
      expect(encoded).not.toContain('=');
    });

    it('should use URL-safe characters', () => {
      const data = new Uint8Array(256);
      for (let i = 0; i < 256; i++) data[i] = i;
      const encoded = base64UrlEncode(data);
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
    });
  });
});

describe('OAuthConnector', () => {
  let storage: SecureStorage;
  let connector: OAuthConnector;

  beforeEach(() => {
    storage = createMockStorage();
    connector = new OAuthConnector(storage);
  });

  describe('storeTokens / getStoredTokens', () => {
    it('should store and retrieve tokens', async () => {
      const tokens: AuthResult = {
        accessToken: 'access_123',
        refreshToken: 'refresh_456',
        expiresIn: 3600,
        tokenType: 'Bearer',
      };
      await connector.storeTokens('account1', tokens);
      const retrieved = await connector.getStoredTokens('account1');
      expect(retrieved).toEqual(tokens);
    });

    it('should return null for non-existent account', async () => {
      const result = await connector.getStoredTokens('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('clearTokens', () => {
    it('should remove stored tokens', async () => {
      const tokens: AuthResult = {
        accessToken: 'access_123',
        refreshToken: 'refresh_456',
        expiresIn: 3600,
        tokenType: 'Bearer',
      };
      await connector.storeTokens('account1', tokens);
      await connector.clearTokens('account1');
      const result = await connector.getStoredTokens('account1');
      expect(result).toBeNull();
    });
  });

  describe('exchangeCodeForTokens', () => {
    it('should throw on failed token exchange', async () => {
      // Mock fetch to return an error
      const originalFetch = globalThis.fetch;
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
      });

      await expect(
        connector.exchangeCodeForTokens('bad_code', {
          clientId: 'client',
          redirectUri: 'http://localhost',
          scopes: ['calendar'],
          authorizationEndpoint: 'https://auth.example.com/authorize',
          tokenEndpoint: 'https://auth.example.com/token',
        }),
      ).rejects.toThrow('OAuth token exchange failed (400)');

      globalThis.fetch = originalFetch;
    });

    it('should exchange code for tokens successfully', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'new_access',
          refresh_token: 'new_refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      const result = await connector.exchangeCodeForTokens('valid_code', {
        clientId: 'client',
        redirectUri: 'http://localhost',
        scopes: ['calendar'],
        authorizationEndpoint: 'https://auth.example.com/authorize',
        tokenEndpoint: 'https://auth.example.com/token',
        codeVerifier: generateCodeVerifier(),
      });

      expect(result.accessToken).toBe('new_access');
      expect(result.refreshToken).toBe('new_refresh');
      expect(result.expiresIn).toBe(3600);

      // Verify PKCE code_verifier was sent
      const fetchCall = (globalThis.fetch as jest.Mock).mock.calls[0];
      const body = fetchCall[1].body as string;
      expect(body).toContain('code_verifier=');

      globalThis.fetch = originalFetch;
    });
  });

  describe('refreshAccessToken', () => {
    it('should refresh token successfully', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'refreshed_access',
          expires_in: 7200,
          token_type: 'Bearer',
        }),
      });

      const refreshInfo: RefreshToken = {
        token: 'old_refresh',
        clientId: 'client',
        tokenEndpoint: 'https://auth.example.com/token',
      };

      const result = await connector.refreshAccessToken(refreshInfo);
      expect(result.accessToken).toBe('refreshed_access');
      // Should keep old refresh token if new one not provided
      expect(result.refreshToken).toBe('old_refresh');

      globalThis.fetch = originalFetch;
    });

    it('should throw on refresh failure', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'invalid_token',
      });

      const refreshInfo: RefreshToken = {
        token: 'expired_refresh',
        clientId: 'client',
        tokenEndpoint: 'https://auth.example.com/token',
      };

      await expect(connector.refreshAccessToken(refreshInfo)).rejects.toThrow(
        'Token refresh failed (401)',
      );

      globalThis.fetch = originalFetch;
    });
  });
});

describe('OAuthConnector — getTokenExpiryInfo (Security Review 2026-05-02 L6 follow-up)', () => {
  let storage: SecureStorage;
  let connector: OAuthConnector;

  beforeEach(() => {
    storage = createMockStorage();
    connector = new OAuthConnector(storage);
  });

  it('returns null when no tokens are stored', async () => {
    const info = await connector.getTokenExpiryInfo('nonexistent');
    expect(info).toBeNull();
  });

  it('computes absolute expiresAt from storedAt + expiresIn', async () => {
    // Freeze time so the assertion is exact.
    const fakeNow = 1_700_000_000_000;
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(fakeNow);
    const tokens: AuthResult = {
      accessToken: 'access_123',
      refreshToken: 'refresh_456',
      expiresIn: 3600,
      tokenType: 'Bearer',
    };
    await connector.storeTokens('account1', tokens);
    dateSpy.mockRestore();

    const info = await connector.getTokenExpiryInfo('account1');
    expect(info).toEqual({
      expiresAt: fakeNow + 3600 * 1000,
      recentlyRejected: false,
    });
  });

  it('returns expiresAt=null when expiresIn is missing or non-positive', async () => {
    const tokens: AuthResult = {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 0,
      tokenType: 'Bearer',
    };
    await connector.storeTokens('account1', tokens);
    const info = await connector.getTokenExpiryInfo('account1');
    expect(info?.expiresAt).toBeNull();
    expect(info?.recentlyRejected).toBe(false);
  });

  it('reports recentlyRejected=true after markTokenRejected', async () => {
    const tokens: AuthResult = {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 3600,
      tokenType: 'Bearer',
    };
    await connector.storeTokens('account1', tokens);

    let info = await connector.getTokenExpiryInfo('account1');
    expect(info?.recentlyRejected).toBe(false);

    await connector.markTokenRejected('account1');

    info = await connector.getTokenExpiryInfo('account1');
    expect(info?.recentlyRejected).toBe(true);
  });

  it('markTokenRejected is a no-op when no tokens are stored', async () => {
    await expect(connector.markTokenRejected('nonexistent')).resolves.toBeUndefined();
  });

  it('getStoredTokens stays backward-compatible — storedAt / recentlyRejected are stripped', async () => {
    const tokens: AuthResult = {
      accessToken: 'access_123',
      refreshToken: 'refresh_456',
      expiresIn: 3600,
      tokenType: 'Bearer',
    };
    await connector.storeTokens('account1', tokens);
    await connector.markTokenRejected('account1');

    const retrieved = await connector.getStoredTokens('account1');
    expect(retrieved).toEqual(tokens);
    // No leakage of internal fields into the public shape.
    expect(retrieved).not.toHaveProperty('storedAt');
    expect(retrieved).not.toHaveProperty('recentlyRejected');
  });

  it('gracefully handles legacy records that lack storedAt', async () => {
    // Simulate a record written by pre-L6 code.
    await storage.setItem(
      'oauth_tokens_legacy',
      JSON.stringify({
        accessToken: 'legacy',
        refreshToken: 'legacy_refresh',
        expiresIn: 3600,
        tokenType: 'Bearer',
      }),
    );

    const info = await connector.getTokenExpiryInfo('legacy');
    // storedAt missing → expiresAt unknown → the cached checker will
    // fall through to the 5-minute probe cache, which is still a
    // massive reduction in provider calls.
    expect(info).toEqual({ expiresAt: null, recentlyRejected: false });

    // The legacy record is still readable via getStoredTokens.
    const retrieved = await connector.getStoredTokens('legacy');
    expect(retrieved?.accessToken).toBe('legacy');
  });
});
