/**
 * CalendarAccountService — connect and remove calendar accounts.
 *
 * - Connect: OAuth flow → store credentials → write account record → update Zustand store → initial sync
 * - Remove: delete account row (CASCADE deletes events, sync_queue, privacy_preferences,
 *   event_visibility_overrides) → update Zustand stores → revoke OAuth → clear secure storage
 *
 * Requirements: 1.2, 1.5, 1.6
 */

import type { DatabaseDriver } from '../db/database';
import type { CalendarProviderAdapter, OAuthConfig, AuthResult, SecureStorage } from '../providers/types';
import type { SyncEngine } from '../sync/types';
import type { CalendarAccount, ProviderId, VisibilityLevel } from '../types/models';

/**
 * Interface for the in-memory calendar accounts store.
 * Decouples the service from the concrete Zustand store implementation.
 */
export interface AccountsStoreAdapter {
  addAccount(account: CalendarAccount): void;
  removeAccount(id: string): void;
}

/**
 * Interface for the in-memory events store (used to clear events on account removal).
 */
export interface EventsStoreForAccounts {
  removeEventsByAccount(calendarAccountId: string): void;
}

/** Input for connecting a new calendar account */
export interface ConnectAccountInput {
  userId: string;
  providerId: ProviderId;
  oauthConfig: OAuthConfig;
  displayName: string;
  email: string;
  color?: string;
  visibility?: VisibilityLevel;
}

/** Result of a connect or remove operation */
export interface AccountResult {
  success: boolean;
  accountId?: string;
  error?: string;
  /** Whether the failed operation can be retried (Req 1.5) */
  retryable?: boolean;
}

export interface CalendarAccountServiceConfig {
  db: DatabaseDriver;
  syncEngine: SyncEngine;
  adapters: Map<string, CalendarProviderAdapter>;
  secureStorage: SecureStorage;
  /** Optional Zustand store adapter for keeping in-memory accounts state in sync */
  accountsStore?: AccountsStoreAdapter;
  /** Optional Zustand events store adapter for clearing events on account removal */
  eventsStore?: EventsStoreForAccounts;
  /**
   * Optional callback to check if the user can connect more accounts.
   * Returns true if allowed, false if at the Free tier limit (Req 1.3).
   * When false, the service returns an error with an upgrade prompt message.
   */
  canConnectAccount?: (userId: string) => Promise<boolean>;
}

/**
 * Generate a UUID v4 compliant ID.
 * Design doc specifies CalendarAccount.id as UUID.
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface CalendarAccountService {
  connectAccount(input: ConnectAccountInput): Promise<AccountResult>;
  removeAccount(accountId: string): Promise<AccountResult>;
  getAccount(accountId: string): Promise<CalendarAccount | null>;
  getAccountsByUser(userId: string): Promise<CalendarAccount[]>;
}

/**
 * Creates a CalendarAccountService instance.
 */
export function createCalendarAccountService(
  config: CalendarAccountServiceConfig,
): CalendarAccountService {
  const { db, syncEngine, adapters, secureStorage, accountsStore, eventsStore, canConnectAccount } = config;

  /**
   * Validate PKCE parameters are present for mobile OAuth flows (Design Decision #8).
   * Returns true if PKCE params are present or if the platform doesn't require them.
   */
  function validatePKCE(oauthConfig: OAuthConfig): boolean {
    // If codeVerifier is provided, codeChallenge must also be provided
    if (oauthConfig.codeVerifier && !oauthConfig.codeChallenge) return false;
    if (oauthConfig.codeChallenge && !oauthConfig.codeVerifier) return false;
    return true;
  }

  /**
   * Connect account: OAuth flow → store credentials → write account record → update store → initial sync.
   * Req 1.2: Complete OAuth 2.0 flow and store credentials securely.
   * Req 1.5: Display descriptive error and offer retry on failure.
   */
  async function connectAccount(input: ConnectAccountInput): Promise<AccountResult> {
    const adapter = adapters.get(input.providerId);
    if (!adapter) {
      return { success: false, error: `No adapter for provider: ${input.providerId}`, retryable: false };
    }

    // Gap #7 fix: Validate PKCE parameters (Design Decision #8)
    if (!validatePKCE(input.oauthConfig)) {
      return {
        success: false,
        error: 'Invalid PKCE configuration: both codeVerifier and codeChallenge must be provided together',
        retryable: true,
      };
    }

    // Req 1.3: Check Free tier account limit before proceeding
    if (canConnectAccount) {
      const allowed = await canConnectAccount(input.userId);
      if (!allowed) {
        return {
          success: false,
          error: 'Account limit reached. Upgrade to Pro for unlimited calendar accounts.',
          retryable: false,
        };
      }
    }

    const accountId = generateUUID();

    try {
      // Step 1: Run OAuth flow via the provider adapter
      const authResult: AuthResult = await adapter.authenticate(input.oauthConfig);

      // Step 2: Store credentials in secure storage
      await secureStorage.setItem(
        `oauth_tokens_${accountId}`,
        JSON.stringify(authResult),
      );

      // Step 3: Write account record to calendar_accounts table
      const now = Date.now();
      await db.execute(
        `INSERT INTO calendar_accounts (id, user_id, provider_id, display_name, email, color, visibility, sync_token, last_synced_at, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          accountId,
          input.userId,
          input.providerId,
          input.displayName,
          input.email,
          input.color ?? '#4285F4',
          input.visibility ?? 'public',
          null,
          null,
          'active',
          now,
        ],
      );

      // Step 4: Update Zustand accounts store so UI reflects the new account immediately (Gap #4 fix)
      if (accountsStore) {
        accountsStore.addAccount({
          id: accountId,
          userId: input.userId,
          providerId: input.providerId,
          displayName: input.displayName,
          email: input.email,
          color: input.color ?? '#4285F4',
          visibility: (input.visibility ?? 'public') as VisibilityLevel,
          syncToken: null,
          lastSyncedAt: null,
          status: 'active',
          createdAt: new Date(now),
        });
      }

      // Step 5: Increment connected_account_count in user_subscription table
      await db.execute(
        `UPDATE user_subscription SET connected_account_count = connected_account_count + 1 WHERE user_id = ?`,
        [input.userId],
      );

      // Step 6: Trigger initial full sync via SyncEngine
      try {
        await syncEngine.fullSync(accountId);
      } catch {
        // Sync failure is non-fatal — account is connected, sync will retry
      }

      return { success: true, accountId };
    } catch (err) {
      // Clean up on failure: remove any stored credentials
      try {
        await secureStorage.removeItem(`oauth_tokens_${accountId}`);
      } catch {
        // Best-effort cleanup
      }

      const message = err instanceof Error ? err.message : 'Unknown error';
      // Gap #6 fix: Include retryable flag so UI can offer retry option (Req 1.5)
      return { success: false, error: message, retryable: true };
    }
  }

  /**
   * Remove account: delete account row (CASCADE) → update stores → revoke OAuth → clear secure storage.
   * Req 1.6: Remove all locally cached data within 5 seconds via CASCADE.
   */
  async function removeAccount(accountId: string): Promise<AccountResult> {
    try {
      // Verify account exists
      const rows = await db.query<{ id: string; provider_id: string; user_id: string }>(
        `SELECT id, provider_id, user_id FROM calendar_accounts WHERE id = ?`,
        [accountId],
      );

      if (rows.length === 0) {
        return { success: false, error: `Account ${accountId} not found` };
      }

      const providerId = rows[0].provider_id;
      const userId = rows[0].user_id;

      // Step 1: Cancel any pending/in-progress sync queue entries for this account
      // to prevent the sync engine from racing against the CASCADE delete.
      await db.execute(
        `UPDATE sync_queue SET status = 'completed' WHERE calendar_account_id = ? AND status IN ('pending', 'in_progress')`,
        [accountId],
      );

      // Step 2: Delete account row — CASCADE deletes events, sync_queue,
      // privacy_preferences, event_visibility_overrides
      await db.execute(
        `DELETE FROM calendar_accounts WHERE id = ?`,
        [accountId],
      );

      // Step 3: Decrement connected_account_count in user_subscription table
      await db.execute(
        `UPDATE user_subscription SET connected_account_count = MAX(0, connected_account_count - 1) WHERE user_id = ?`,
        [userId],
      );

      // Gap #5 fix: Clear events from Zustand events store for this account
      if (eventsStore) {
        eventsStore.removeEventsByAccount(accountId);
      }

      // Gap #4 fix: Remove account from Zustand accounts store
      if (accountsStore) {
        accountsStore.removeAccount(accountId);
      }

      // Step 2: Revoke OAuth access via provider adapter (best-effort)
      const adapter = adapters.get(providerId);
      if (adapter) {
        try {
          await adapter.revokeAccess(accountId);
        } catch {
          // Revocation is best-effort — local data is already deleted
        }
      }

      // Step 3: Clear secure storage credentials
      try {
        await secureStorage.removeItem(`oauth_tokens_${accountId}`);
      } catch {
        // Best-effort cleanup
      }

      return { success: true, accountId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Get a single account by ID.
   */
  async function getAccount(accountId: string): Promise<CalendarAccount | null> {
    const rows = await db.query<Record<string, unknown>>(
      `SELECT * FROM calendar_accounts WHERE id = ?`,
      [accountId],
    );
    if (rows.length === 0) return null;
    return mapRowToAccount(rows[0]);
  }

  /**
   * Get all accounts for a user.
   */
  async function getAccountsByUser(userId: string): Promise<CalendarAccount[]> {
    const rows = await db.query<Record<string, unknown>>(
      `SELECT * FROM calendar_accounts WHERE user_id = ?`,
      [userId],
    );
    return rows.map(mapRowToAccount);
  }

  return { connectAccount, removeAccount, getAccount, getAccountsByUser };
}

/**
 * Maps a raw database row to a CalendarAccount object.
 */
function mapRowToAccount(row: Record<string, unknown>): CalendarAccount {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    providerId: row.provider_id as ProviderId,
    displayName: row.display_name as string,
    email: row.email as string,
    color: row.color as string,
    visibility: (row.visibility as VisibilityLevel) ?? 'public',
    syncToken: (row.sync_token as string) ?? null,
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at as number) : null,
    status: (row.status as CalendarAccount['status']) ?? 'active',
    createdAt: new Date(row.created_at as number),
  };
}
