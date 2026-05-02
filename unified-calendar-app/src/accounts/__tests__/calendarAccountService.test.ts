/**
 * Unit tests for CalendarAccountService.
 * Requirements: 1.2, 1.6
 */

import { createCalendarAccountService } from '../calendarAccountService';
import type {
  CalendarAccountService,
  ConnectAccountInput,
  AccountsStoreAdapter,
  EventsStoreForAccounts,
} from '../calendarAccountService';
import type { DatabaseDriver } from '../../db/database';
import type { SyncEngine, LocalChange } from '../../sync/types';
import type { CalendarProviderAdapter, OAuthConfig, AuthResult, SecureStorage } from '../../providers/types';
import type { CalendarAccount } from '../../types/models';

// ── Test helpers ──

function createMockDb(): DatabaseDriver & {
  executeCalls: Array<{ sql: string; params?: unknown[] }>;
  queryResults: Map<string, unknown[]>;
} {
  const executeCalls: Array<{ sql: string; params?: unknown[] }> = [];
  const queryResults = new Map<string, unknown[]>();

  return {
    executeCalls,
    queryResults,
    async execute(sql: string, params?: unknown[]): Promise<void> {
      executeCalls.push({ sql, params });
    },
    async query<T = Record<string, unknown>>(sql: string, _params?: unknown[]): Promise<T[]> {
      for (const [pattern, results] of queryResults) {
        if (sql.includes(pattern)) {
          return results as T[];
        }
      }
      return [] as T[];
    },
    async close(): Promise<void> {},
    isOpen(): boolean {
      return true;
    },
    supportsTransactions: false,
    async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      return fn({ execute: this.execute.bind(this), query: this.query.bind(this) });
    },
  };
}

function createMockSyncEngine(): SyncEngine {
  return {
    start: jest.fn(),
    stop: jest.fn(),
    queueLocalChange: jest.fn(),
    processOutboundQueue: jest.fn().mockResolvedValue({
      success: true, syncedCount: 0, failedCount: 0, conflicts: [],
    }),
    handleWebhookNotification: jest.fn().mockResolvedValue(undefined),
    pollProvider: jest.fn().mockResolvedValue({
      created: [], updated: [], deleted: [], nextSyncToken: '',
    }),
    pollingIntervalMs: 300_000,
    getConflicts: jest.fn().mockReturnValue([]),
    resolveConflict: jest.fn().mockResolvedValue(undefined),
    fullSync: jest.fn().mockResolvedValue({
      success: true, syncedCount: 0, failedCount: 0, conflicts: [],
    }),
    syncAllPending: jest.fn().mockResolvedValue({
      success: true, syncedCount: 0, failedCount: 0, conflicts: [],
    }),
    state: 'Idle',
  };
}

function createMockAdapter(): CalendarProviderAdapter {
  return {
    providerId: 'google',
    authenticate: jest.fn().mockResolvedValue({
      accessToken: 'access-token-123',
      refreshToken: 'refresh-token-456',
      expiresIn: 3600,
      tokenType: 'Bearer',
    } as AuthResult),
    refreshToken: jest.fn().mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresIn: 3600,
      tokenType: 'Bearer',
    }),
    revokeAccess: jest.fn().mockResolvedValue(undefined),
    listCalendars: jest.fn().mockResolvedValue([]),
    listEvents: jest.fn().mockResolvedValue([]),
    createEvent: jest.fn().mockResolvedValue('event-id'),
    updateEvent: jest.fn().mockResolvedValue(undefined),
    deleteEvent: jest.fn().mockResolvedValue(undefined),
    getChanges: jest.fn().mockResolvedValue({
      created: [], updated: [], deleted: [], nextSyncToken: 'token-1',
    }),
  };
}

function createMockSecureStorage(): SecureStorage & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  return {
    store,
    getItem: jest.fn(async (key: string) => store.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { store.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { store.delete(key); }),
  };
}

const baseOAuthConfig: OAuthConfig = {
  clientId: 'client-id',
  redirectUri: 'com.calendar://oauth',
  scopes: ['calendar.read', 'calendar.write'],
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  extraParams: { code: 'auth-code-123' },
};

const baseConnectInput: ConnectAccountInput = {
  userId: 'user-1',
  providerId: 'google',
  oauthConfig: baseOAuthConfig,
  displayName: 'Work Gmail',
  email: 'user@gmail.com',
  color: '#DB4437',
  visibility: 'public',
};

// ── Tests ──

describe('CalendarAccountService', () => {
  let db: ReturnType<typeof createMockDb>;
  let syncEngine: ReturnType<typeof createMockSyncEngine>;
  let adapter: ReturnType<typeof createMockAdapter>;
  let secureStorage: ReturnType<typeof createMockSecureStorage>;
  let service: CalendarAccountService;

  beforeEach(() => {
    db = createMockDb();
    syncEngine = createMockSyncEngine();
    adapter = createMockAdapter();
    secureStorage = createMockSecureStorage();

    const adapters = new Map<string, CalendarProviderAdapter>();
    adapters.set('google', adapter);

    service = createCalendarAccountService({
      db,
      syncEngine,
      adapters,
      secureStorage,
    });
  });

  describe('connectAccount', () => {
    it('should run OAuth flow via provider adapter (Req 1.2)', async () => {
      const result = await service.connectAccount(baseConnectInput);

      expect(result.success).toBe(true);
      expect(adapter.authenticate).toHaveBeenCalledWith(baseOAuthConfig);
    });

    it('should store credentials in secure storage (Req 1.2)', async () => {
      const result = await service.connectAccount(baseConnectInput);

      expect(secureStorage.setItem).toHaveBeenCalledTimes(1);
      const storedKey = (secureStorage.setItem as jest.Mock).mock.calls[0][0];
      expect(storedKey).toContain('oauth_tokens_');
      const storedValue = JSON.parse((secureStorage.setItem as jest.Mock).mock.calls[0][1]);
      expect(storedValue.accessToken).toBe('access-token-123');
    });

    it('should write account record to calendar_accounts table', async () => {
      const result = await service.connectAccount(baseConnectInput);

      expect(result.success).toBe(true);
      const insertCall = db.executeCalls.find((c) => c.sql.includes('INSERT INTO calendar_accounts'));
      expect(insertCall).toBeDefined();
      expect(insertCall!.params).toContain('user-1');
      expect(insertCall!.params).toContain('google');
      expect(insertCall!.params).toContain('Work Gmail');
      expect(insertCall!.params).toContain('user@gmail.com');
      expect(insertCall!.params).toContain('#DB4437');
      expect(insertCall!.params).toContain('active');
    });

    it('should trigger initial full sync via SyncEngine', async () => {
      const result = await service.connectAccount(baseConnectInput);

      expect(result.success).toBe(true);
      expect(syncEngine.fullSync).toHaveBeenCalledTimes(1);
      expect(syncEngine.fullSync).toHaveBeenCalledWith(result.accountId);
    });

    it('should return accountId on success', async () => {
      const result = await service.connectAccount(baseConnectInput);

      expect(result.success).toBe(true);
      expect(result.accountId).toBeDefined();
      expect(typeof result.accountId).toBe('string');
    });

    it('should use default color when not provided', async () => {
      const input = { ...baseConnectInput, color: undefined };
      await service.connectAccount(input);

      const insertCall = db.executeCalls.find((c) => c.sql.includes('INSERT INTO calendar_accounts'));
      expect(insertCall!.params).toContain('#4285F4');
    });

    it('should use default visibility when not provided', async () => {
      const input = { ...baseConnectInput, visibility: undefined };
      await service.connectAccount(input);

      const insertCall = db.executeCalls.find((c) => c.sql.includes('INSERT INTO calendar_accounts'));
      expect(insertCall!.params).toContain('public');
    });

    it('should fail if no adapter exists for provider', async () => {
      const result = await service.connectAccount({
        ...baseConnectInput,
        providerId: 'caldav',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No adapter for provider');
    });

    it('should fail if OAuth flow throws', async () => {
      (adapter.authenticate as jest.Mock).mockRejectedValue(new Error('OAuth denied'));

      const result = await service.connectAccount(baseConnectInput);

      expect(result.success).toBe(false);
      expect(result.error).toContain('OAuth denied');
    });

    it('should clean up secure storage on OAuth failure', async () => {
      (adapter.authenticate as jest.Mock).mockRejectedValue(new Error('OAuth denied'));

      await service.connectAccount(baseConnectInput);

      expect(secureStorage.removeItem).toHaveBeenCalled();
    });

    it('should succeed even if initial sync fails (non-fatal)', async () => {
      (syncEngine.fullSync as jest.Mock).mockRejectedValue(new Error('Network error'));

      const result = await service.connectAccount(baseConnectInput);

      expect(result.success).toBe(true);
      expect(result.accountId).toBeDefined();
    });

    it('should fail if DB insert throws', async () => {
      const originalExecute = db.execute.bind(db);
      db.execute = async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO calendar_accounts')) {
          throw new Error('DB full');
        }
        return originalExecute(sql, params);
      };

      const result = await service.connectAccount(baseConnectInput);

      expect(result.success).toBe(false);
      expect(result.error).toContain('DB full');
    });
  });

  describe('removeAccount', () => {
    beforeEach(() => {
      db.queryResults.set('FROM calendar_accounts WHERE id', [
        { id: 'account-1', provider_id: 'google' },
      ]);
    });

    it('should delete account row via CASCADE (Req 1.6)', async () => {
      const result = await service.removeAccount('account-1');

      expect(result.success).toBe(true);
      const deleteCall = db.executeCalls.find((c) => c.sql.includes('DELETE FROM calendar_accounts'));
      expect(deleteCall).toBeDefined();
      expect(deleteCall!.params).toContain('account-1');
    });

    it('should revoke OAuth access via provider adapter', async () => {
      await service.removeAccount('account-1');

      expect(adapter.revokeAccess).toHaveBeenCalledWith('account-1');
    });

    it('should clear secure storage credentials', async () => {
      await service.removeAccount('account-1');

      expect(secureStorage.removeItem).toHaveBeenCalledWith('oauth_tokens_account-1');
    });

    it('should return accountId on success', async () => {
      const result = await service.removeAccount('account-1');

      expect(result.success).toBe(true);
      expect(result.accountId).toBe('account-1');
    });

    it('should fail if account does not exist', async () => {
      db.queryResults.delete('FROM calendar_accounts WHERE id');

      const result = await service.removeAccount('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should succeed even if OAuth revocation fails (best-effort)', async () => {
      (adapter.revokeAccess as jest.Mock).mockRejectedValue(new Error('Network error'));

      const result = await service.removeAccount('account-1');

      expect(result.success).toBe(true);
    });

    it('should succeed even if secure storage cleanup fails (best-effort)', async () => {
      (secureStorage.removeItem as jest.Mock).mockRejectedValue(new Error('Storage error'));

      const result = await service.removeAccount('account-1');

      expect(result.success).toBe(true);
    });

    it('should fail if DB delete throws', async () => {
      const originalExecute = db.execute.bind(db);
      db.execute = async (sql: string, params?: unknown[]) => {
        if (sql.includes('DELETE FROM calendar_accounts')) {
          throw new Error('DB locked');
        }
        return originalExecute(sql, params);
      };

      const result = await service.removeAccount('account-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('DB locked');
    });

    it('should cancel pending sync queue entries before delete (Gap #9)', async () => {
      await service.removeAccount('account-1');

      const cancelCall = db.executeCalls.find(
        (c) => c.sql.includes('UPDATE sync_queue SET status') && c.sql.includes('completed'),
      );
      expect(cancelCall).toBeDefined();
      expect(cancelCall!.params).toContain('account-1');
    });

    it('should delete account before revoking OAuth (order matters for speed)', async () => {
      const callOrder: string[] = [];
      const originalExecute = db.execute.bind(db);
      db.execute = async (sql: string, params?: unknown[]) => {
        if (sql.includes('DELETE FROM calendar_accounts')) {
          callOrder.push('db_delete');
        }
        return originalExecute(sql, params);
      };
      (adapter.revokeAccess as jest.Mock).mockImplementation(async () => {
        callOrder.push('revoke');
      });

      await service.removeAccount('account-1');

      expect(callOrder[0]).toBe('db_delete');
      expect(callOrder[1]).toBe('revoke');
    });
  });

  describe('getAccount', () => {
    it('should return null for nonexistent account', async () => {
      const account = await service.getAccount('nonexistent');
      expect(account).toBeNull();
    });

    it('should return mapped CalendarAccount for existing account', async () => {
      const now = Date.now();
      db.queryResults.set('FROM calendar_accounts WHERE id', [
        {
          id: 'account-1',
          user_id: 'user-1',
          provider_id: 'google',
          display_name: 'Work Gmail',
          email: 'user@gmail.com',
          color: '#DB4437',
          visibility: 'public',
          sync_token: 'token-abc',
          last_synced_at: now,
          status: 'active',
          created_at: now,
        },
      ]);

      const account = await service.getAccount('account-1');

      expect(account).not.toBeNull();
      expect(account!.id).toBe('account-1');
      expect(account!.userId).toBe('user-1');
      expect(account!.providerId).toBe('google');
      expect(account!.displayName).toBe('Work Gmail');
      expect(account!.email).toBe('user@gmail.com');
      expect(account!.status).toBe('active');
      expect(account!.lastSyncedAt).toBeInstanceOf(Date);
    });
  });

  describe('getAccountsByUser', () => {
    it('should return empty array when no accounts', async () => {
      const accounts = await service.getAccountsByUser('user-1');
      expect(accounts).toEqual([]);
    });

    it('should return mapped accounts for user', async () => {
      const now = Date.now();
      db.queryResults.set('FROM calendar_accounts WHERE user_id', [
        {
          id: 'account-1',
          user_id: 'user-1',
          provider_id: 'google',
          display_name: 'Work',
          email: 'work@gmail.com',
          color: '#4285F4',
          visibility: 'public',
          sync_token: null,
          last_synced_at: null,
          status: 'active',
          created_at: now,
        },
        {
          id: 'account-2',
          user_id: 'user-1',
          provider_id: 'outlook',
          display_name: 'Personal',
          email: 'user@outlook.com',
          color: '#0078D4',
          visibility: 'private',
          sync_token: null,
          last_synced_at: null,
          status: 'active',
          created_at: now,
        },
      ]);

      const accounts = await service.getAccountsByUser('user-1');

      expect(accounts.length).toBe(2);
      expect(accounts[0].displayName).toBe('Work');
      expect(accounts[1].displayName).toBe('Personal');
    });
  });

  describe('Zustand store integration (Gaps #4, #5)', () => {
    let mockAccountsStore: AccountsStoreAdapter & {
      addedAccounts: CalendarAccount[];
      removedIds: string[];
    };
    let mockEventsStore: EventsStoreForAccounts & {
      removedAccountIds: string[];
    };
    let storeService: CalendarAccountService;

    beforeEach(() => {
      mockAccountsStore = {
        addedAccounts: [],
        removedIds: [],
        addAccount: jest.fn((account: CalendarAccount) => {
          mockAccountsStore.addedAccounts.push(account);
        }),
        removeAccount: jest.fn((id: string) => {
          mockAccountsStore.removedIds.push(id);
        }),
      };

      mockEventsStore = {
        removedAccountIds: [],
        removeEventsByAccount: jest.fn((calendarAccountId: string) => {
          mockEventsStore.removedAccountIds.push(calendarAccountId);
        }),
      };

      const adapters = new Map<string, CalendarProviderAdapter>();
      adapters.set('google', adapter);

      storeService = createCalendarAccountService({
        db,
        syncEngine,
        adapters,
        secureStorage,
        accountsStore: mockAccountsStore,
        eventsStore: mockEventsStore,
      });
    });

    it('should add account to Zustand store on connect (Gap #4)', async () => {
      const result = await storeService.connectAccount(baseConnectInput);

      expect(result.success).toBe(true);
      expect(mockAccountsStore.addAccount).toHaveBeenCalledTimes(1);
      expect(mockAccountsStore.addedAccounts[0].displayName).toBe('Work Gmail');
      expect(mockAccountsStore.addedAccounts[0].email).toBe('user@gmail.com');
      expect(mockAccountsStore.addedAccounts[0].status).toBe('active');
    });

    it('should remove account from Zustand store on remove (Gap #4)', async () => {
      db.queryResults.set('FROM calendar_accounts WHERE id', [
        { id: 'account-1', provider_id: 'google' },
      ]);

      await storeService.removeAccount('account-1');

      expect(mockAccountsStore.removeAccount).toHaveBeenCalledWith('account-1');
    });

    it('should clear events from Zustand events store on remove (Gap #5)', async () => {
      db.queryResults.set('FROM calendar_accounts WHERE id', [
        { id: 'account-1', provider_id: 'google' },
      ]);

      await storeService.removeAccount('account-1');

      expect(mockEventsStore.removeEventsByAccount).toHaveBeenCalledWith('account-1');
    });

    it('should clear events store before accounts store on remove (order)', async () => {
      const callOrder: string[] = [];
      (mockEventsStore.removeEventsByAccount as jest.Mock).mockImplementation(() => {
        callOrder.push('events_removed');
      });
      (mockAccountsStore.removeAccount as jest.Mock).mockImplementation(() => {
        callOrder.push('account_removed');
      });

      db.queryResults.set('FROM calendar_accounts WHERE id', [
        { id: 'account-1', provider_id: 'google' },
      ]);

      await storeService.removeAccount('account-1');

      expect(callOrder[0]).toBe('events_removed');
      expect(callOrder[1]).toBe('account_removed');
    });
  });

  describe('Retryable error flag (Gap #6, Req 1.5)', () => {
    it('should return retryable: true on OAuth failure', async () => {
      (adapter.authenticate as jest.Mock).mockRejectedValue(new Error('OAuth denied'));

      const result = await service.connectAccount(baseConnectInput);

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
    });

    it('should return retryable: false for missing adapter', async () => {
      const result = await service.connectAccount({
        ...baseConnectInput,
        providerId: 'caldav',
      });

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(false);
    });

    it('should return retryable: true on DB failure', async () => {
      const originalExecute = db.execute.bind(db);
      db.execute = async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO calendar_accounts')) {
          throw new Error('DB full');
        }
        return originalExecute(sql, params);
      };

      const result = await service.connectAccount(baseConnectInput);

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
    });
  });

  describe('PKCE validation (Gap #7)', () => {
    it('should fail if codeVerifier is provided without codeChallenge', async () => {
      const result = await service.connectAccount({
        ...baseConnectInput,
        oauthConfig: {
          ...baseOAuthConfig,
          codeVerifier: 'some-verifier-string-that-is-long-enough',
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('PKCE');
      expect(result.retryable).toBe(true);
    });

    it('should fail if codeChallenge is provided without codeVerifier', async () => {
      const result = await service.connectAccount({
        ...baseConnectInput,
        oauthConfig: {
          ...baseOAuthConfig,
          codeChallenge: 'some-challenge-hash',
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('PKCE');
    });

    it('should succeed when both PKCE params are provided', async () => {
      const result = await service.connectAccount({
        ...baseConnectInput,
        oauthConfig: {
          ...baseOAuthConfig,
          codeVerifier: 'some-verifier-string-that-is-long-enough',
          codeChallenge: 'some-challenge-hash',
        },
      });

      expect(result.success).toBe(true);
    });

    it('should succeed when neither PKCE param is provided (web flow)', async () => {
      const result = await service.connectAccount(baseConnectInput);

      expect(result.success).toBe(true);
    });
  });

  describe('Free tier account limit (Gap #7, Req 1.3)', () => {
    it('should block connection when canConnectAccount returns false', async () => {
      const adapters = new Map<string, CalendarProviderAdapter>();
      adapters.set('google', adapter);

      const limitedService = createCalendarAccountService({
        db,
        syncEngine,
        adapters,
        secureStorage,
        canConnectAccount: async () => false,
      });

      const result = await limitedService.connectAccount(baseConnectInput);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Account limit reached');
      expect(result.error).toContain('Upgrade');
      expect(result.retryable).toBe(false);
      // Should not have called authenticate
      expect(adapter.authenticate).not.toHaveBeenCalled();
    });

    it('should allow connection when canConnectAccount returns true', async () => {
      const adapters = new Map<string, CalendarProviderAdapter>();
      adapters.set('google', adapter);

      const limitedService = createCalendarAccountService({
        db,
        syncEngine,
        adapters,
        secureStorage,
        canConnectAccount: async () => true,
      });

      const result = await limitedService.connectAccount(baseConnectInput);

      expect(result.success).toBe(true);
    });

    it('should allow connection when canConnectAccount is not provided', async () => {
      // Default service has no canConnectAccount
      const result = await service.connectAccount(baseConnectInput);

      expect(result.success).toBe(true);
    });
  });

  describe('UUID generation (Gap #2)', () => {
    it('should generate UUID v4 format account IDs', async () => {
      const result = await service.connectAccount(baseConnectInput);

      expect(result.success).toBe(true);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      expect(result.accountId).toMatch(uuidRegex);
    });
  });
});
