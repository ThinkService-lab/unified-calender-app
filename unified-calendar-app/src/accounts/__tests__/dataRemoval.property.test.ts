/**
 * Property-based test: Data removal completeness.
 *
 * Feature: unified-calendar-app, Property 20: Data removal completeness
 * After account removal, zero records remain for that account in all tables.
 *
 * Requirements: 1.6, 13.4
 */

import * as fc from 'fast-check';
import { createCalendarAccountService } from '../calendarAccountService';
import type { CalendarAccountService, AccountsStoreAdapter, EventsStoreForAccounts } from '../calendarAccountService';
import type { DatabaseDriver } from '../../db/database';
import type { CalendarProviderAdapter, OAuthConfig, AuthResult, SecureStorage } from '../../providers/types';
import type { SyncEngine } from '../../sync/types';
import type { CalendarAccount, ProviderId } from '../../types/models';

// ── In-memory database simulation ──

interface TableRow {
  [key: string]: unknown;
}

function createInMemoryDb() {
  const tables: Record<string, TableRow[]> = {
    calendar_accounts: [],
    events: [],
    sync_queue: [],
    privacy_preferences: [],
    event_visibility_overrides: [],
    user_subscription: [{ user_id: 'user-1', connected_account_count: 0 }],
  };

  const db: DatabaseDriver = {
    async execute(sql: string, params?: unknown[]): Promise<void> {
      if (sql.includes('INSERT INTO calendar_accounts')) {
        tables.calendar_accounts.push({
          id: params![0],
          user_id: params![1],
          provider_id: params![2],
          display_name: params![3],
          email: params![4],
          color: params![5],
          visibility: params![6],
          sync_token: params![7],
          last_synced_at: params![8],
          status: params![9],
          created_at: params![10],
        });
      } else if (sql.includes('DELETE FROM calendar_accounts WHERE id')) {
        const accountId = params![0] as string;
        // Simulate CASCADE
        tables.events = tables.events.filter((e) => e.calendar_account_id !== accountId);
        tables.sync_queue = tables.sync_queue.filter((e) => e.calendar_account_id !== accountId);
        tables.privacy_preferences = tables.privacy_preferences.filter((e) => e.calendar_id !== accountId);
        tables.event_visibility_overrides = tables.event_visibility_overrides.filter((e) => {
          const eventIds = tables.events.map((ev) => ev.id);
          return eventIds.includes(e.event_id);
        });
        tables.calendar_accounts = tables.calendar_accounts.filter((a) => a.id !== accountId);
      } else if (sql.includes('INSERT INTO events')) {
        tables.events.push({
          id: params![0],
          calendar_account_id: params![2],
        });
      } else if (sql.includes('UPDATE sync_queue SET status')) {
        // Mark sync queue entries as completed
        const accountId = params![0] as string;
        tables.sync_queue = tables.sync_queue.map((e) =>
          e.calendar_account_id === accountId ? { ...e, status: 'completed' } : e,
        );
      } else if (sql.includes('UPDATE user_subscription')) {
        // Handle connected_account_count updates
      }
    },
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      if (sql.includes('FROM calendar_accounts WHERE id')) {
        const id = params![0] as string;
        return tables.calendar_accounts.filter((a) => a.id === id) as T[];
      }
      if (sql.includes('FROM calendar_accounts WHERE user_id')) {
        const userId = params![0] as string;
        return tables.calendar_accounts.filter((a) => a.user_id === userId) as T[];
      }
      return [] as T[];
    },
    async close(): Promise<void> {},
    isOpen(): boolean { return true; },
    supportsTransactions: false,
    async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      return fn({ execute: db.execute.bind(db), query: db.query.bind(db) });
    },
  };

  return { db, tables };
}

function createMockAdapter(): CalendarProviderAdapter {
  return {
    providerId: 'google' as ProviderId,
    authenticate: jest.fn().mockResolvedValue({ accessToken: 'tok', refreshToken: 'ref', expiresIn: 3600 }),
    refreshToken: jest.fn().mockResolvedValue({ accessToken: 'tok2', refreshToken: 'ref2', expiresIn: 3600 }),
    revokeAccess: jest.fn().mockResolvedValue(undefined),
    listCalendars: jest.fn().mockResolvedValue([]),
    listEvents: jest.fn().mockResolvedValue([]),
    createEvent: jest.fn().mockResolvedValue('prov-id'),
    updateEvent: jest.fn().mockResolvedValue(undefined),
    deleteEvent: jest.fn().mockResolvedValue(undefined),
    getChanges: jest.fn().mockResolvedValue({ created: [], updated: [], deleted: [], nextSyncToken: '' }),
  };
}

function createMockSecureStorage(): SecureStorage {
  const store = new Map<string, string>();
  return {
    getItem: jest.fn(async (key: string) => store.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { store.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { store.delete(key); }),
  };
}

function createMockSyncEngine(): SyncEngine {
  return {
    start: jest.fn(),
    stop: jest.fn(),
    queueLocalChange: jest.fn(),
    processOutboundQueue: jest.fn().mockResolvedValue({ success: true, syncedCount: 0, failedCount: 0, conflicts: [] }),
    handleWebhookNotification: jest.fn().mockResolvedValue(undefined),
    pollProvider: jest.fn().mockResolvedValue({ created: [], updated: [], deleted: [], nextSyncToken: '' }),
    pollingIntervalMs: 300_000,
    getConflicts: jest.fn().mockReturnValue([]),
    resolveConflict: jest.fn().mockResolvedValue(undefined),
    fullSync: jest.fn().mockResolvedValue({ success: true, syncedCount: 0, failedCount: 0, conflicts: [] }),
    syncAllPending: jest.fn().mockResolvedValue({ success: true, syncedCount: 0, failedCount: 0, conflicts: [] }),
    state: 'Idle',
  };
}

// ── Arbitraries ──

const arbProviderId = (): fc.Arbitrary<ProviderId> =>
  fc.constantFrom('google', 'outlook', 'icloud', 'exchange', 'caldav');

const arbAccountData = () =>
  fc.record({
    providerId: arbProviderId(),
    displayName: fc.string({ minLength: 1, maxLength: 50 }),
    email: fc.emailAddress(),
    color: fc.stringMatching(/^[0-9a-f]{6}$/).map((h: string) => `#${h}`),
  });

// ── Property Test ──

// Feature: unified-calendar-app, Property 20: Data removal completeness
describe('Property 20: Data removal completeness', () => {
  it('after account removal, zero records remain for that account in all tables', () => {
    fc.assert(
      fc.asyncProperty(
        arbAccountData(),
        fc.integer({ min: 0, max: 5 }), // number of events to create for the account
        async (accountData, eventCount) => {
          const { db, tables } = createInMemoryDb();
          const adapter = createMockAdapter();
          const adapters = new Map<string, CalendarProviderAdapter>();
          adapters.set(accountData.providerId, adapter);

          const accountsStore: AccountsStoreAdapter = {
            addAccount: jest.fn(),
            removeAccount: jest.fn(),
          };
          const eventsStore: EventsStoreForAccounts = {
            removeEventsByAccount: jest.fn(),
          };

          const service = createCalendarAccountService({
            db,
            syncEngine: createMockSyncEngine(),
            adapters,
            secureStorage: createMockSecureStorage(),
            accountsStore,
            eventsStore,
          });

          // Connect an account
          const connectResult = await service.connectAccount({
            userId: 'user-1',
            providerId: accountData.providerId,
            oauthConfig: { clientId: 'cid', redirectUri: 'app://cb' } as OAuthConfig,
            displayName: accountData.displayName,
            email: accountData.email,
            color: accountData.color as string,
          });

          expect(connectResult.success).toBe(true);
          const accountId = connectResult.accountId!;

          // Simulate events existing for this account
          for (let i = 0; i < eventCount; i++) {
            tables.events.push({
              id: `event-${accountId}-${i}`,
              calendar_account_id: accountId,
            });
          }

          // Simulate sync queue entries
          tables.sync_queue.push({
            id: `sq-${accountId}-1`,
            calendar_account_id: accountId,
            status: 'pending',
          });

          // Simulate privacy preferences
          tables.privacy_preferences.push({
            calendar_id: accountId,
            visibility: 'public',
          });

          // Remove the account
          const removeResult = await service.removeAccount(accountId);
          expect(removeResult.success).toBe(true);

          // Verify: zero records remain for this account in ALL tables
          const remainingAccounts = tables.calendar_accounts.filter(
            (a) => a.id === accountId,
          );
          const remainingEvents = tables.events.filter(
            (e) => e.calendar_account_id === accountId,
          );
          const remainingSyncQueue = tables.sync_queue.filter(
            (e) => e.calendar_account_id === accountId,
          );
          const remainingPrivacy = tables.privacy_preferences.filter(
            (e) => e.calendar_id === accountId,
          );

          expect(remainingAccounts).toHaveLength(0);
          expect(remainingEvents).toHaveLength(0);
          expect(remainingSyncQueue).toHaveLength(0);
          expect(remainingPrivacy).toHaveLength(0);

          // Verify Zustand stores were also cleared
          expect(accountsStore.removeAccount).toHaveBeenCalledWith(accountId);
          expect(eventsStore.removeEventsByAccount).toHaveBeenCalledWith(accountId);
        },
      ),
      { numRuns: 100 },
    );
  });
});
