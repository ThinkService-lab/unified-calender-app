/**
 * Unit tests for BaseCalendarAdapter.
 * Requirements: 1.1, 1.2, 1.5, 13.2
 */

import { BaseCalendarAdapter, type BaseAdapterConfig } from '../baseAdapter';
import type {
  SecureStorage,
  Calendar,
  RawEventData,
  DateRange,
  ChangeSet,
  OAuthConfig,
} from '../types';

/** In-memory SecureStorage for testing */
function createMockStorage(): SecureStorage {
  const store = new Map<string, string>();
  return {
    async getItem(key: string) { return store.get(key) ?? null; },
    async setItem(key: string, value: string) { store.set(key, value); },
    async removeItem(key: string) { store.delete(key); },
  };
}

/** Concrete test adapter extending the abstract base */
class TestAdapter extends BaseCalendarAdapter {
  async listCalendars(_accountId: string): Promise<Calendar[]> {
    return [{ id: 'cal1', name: 'Test', color: '#000', isPrimary: true, accessRole: 'owner' }];
  }
  async listEvents(_calendarId: string, _range: DateRange): Promise<RawEventData[]> {
    return [];
  }
  async createEvent(_calendarId: string, _event: RawEventData): Promise<string> {
    return 'event_1';
  }
  async updateEvent(_calendarId: string, _eventId: string, _event: RawEventData): Promise<void> {}
  async deleteEvent(_calendarId: string, _eventId: string): Promise<void> {}
  async getChanges(_calendarId: string, _syncToken: string | null): Promise<ChangeSet> {
    return { created: [], updated: [], deleted: [], nextSyncToken: 'token_1' };
  }
}

describe('BaseCalendarAdapter', () => {
  let storage: SecureStorage;
  let adapter: TestAdapter;

  beforeEach(() => {
    storage = createMockStorage();
    const config: BaseAdapterConfig = {
      providerId: 'google',
      baseURL: 'https://www.googleapis.com/calendar/v3',
      storage,
    };
    adapter = new TestAdapter(config);
  });

  it('should have the correct providerId', () => {
    expect(adapter.providerId).toBe('google');
  });

  describe('authenticate', () => {
    it('should throw if no authorization code provided', async () => {
      const config: OAuthConfig = {
        clientId: 'client_id',
        redirectUri: 'http://localhost/callback',
        scopes: ['calendar'],
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
      };

      await expect(adapter.authenticate(config)).rejects.toThrow(
        'Authorization code is required',
      );
    });

    it('should authenticate with PKCE and store tokens', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access_token_123',
          refresh_token: 'refresh_token_456',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      const config: OAuthConfig = {
        clientId: 'client_id',
        redirectUri: 'http://localhost/callback',
        scopes: ['calendar'],
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        extraParams: { code: 'auth_code_789', accountId: 'test_account' },
      };

      const result = await adapter.authenticate(config);
      expect(result.accessToken).toBe('access_token_123');
      expect(result.refreshToken).toBe('refresh_token_456');

      // Verify PKCE was used
      const fetchCall = (globalThis.fetch as jest.Mock).mock.calls[0];
      const body = fetchCall[1].body as string;
      expect(body).toContain('code_verifier=');

      globalThis.fetch = originalFetch;
    });
  });

  describe('revokeAccess', () => {
    it('should clear stored tokens', async () => {
      // Store some tokens first
      const originalFetch = globalThis.fetch;
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access',
          refresh_token: 'refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      });

      const config: OAuthConfig = {
        clientId: 'client_id',
        redirectUri: 'http://localhost/callback',
        scopes: ['calendar'],
        authorizationEndpoint: 'https://auth.example.com/authorize',
        tokenEndpoint: 'https://auth.example.com/token',
        extraParams: { code: 'code', accountId: 'revoke_test' },
      };

      await adapter.authenticate(config);
      await adapter.revokeAccess('revoke_test');

      // Tokens should be cleared
      const stored = await storage.getItem('oauth_tokens_revoke_test');
      expect(stored).toBeNull();

      globalThis.fetch = originalFetch;
    });
  });

  describe('abstract methods', () => {
    it('should delegate listCalendars to subclass', async () => {
      const calendars = await adapter.listCalendars('account1');
      expect(calendars).toHaveLength(1);
      expect(calendars[0].name).toBe('Test');
    });

    it('should delegate getChanges to subclass', async () => {
      const changes = await adapter.getChanges('cal1', null);
      expect(changes.nextSyncToken).toBe('token_1');
    });
  });
});
