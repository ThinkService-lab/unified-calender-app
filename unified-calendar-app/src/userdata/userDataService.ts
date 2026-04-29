/**
 * UserDataService — auth event logging, session activity, and account deletion.
 *
 * - Log all auth events (login, logout, token_refresh, token_revoked, password_change)
 * - Expose session activity view showing recent sign-ins
 * - Implement rate limiting on authentication endpoints
 * - Delete user account: erase local data immediately, schedule server deletion within 30 days
 * - Get deletion status: pending/in_progress/completed
 *
 * Requirements: 13.4, 13.5, 13.6
 */

import type { DatabaseDriver } from '../db/database';
import type { AuthEvent, DeletionReceipt } from '../types';

/** Maximum days for server-side data deletion */
const MAX_DELETION_DAYS = 30;

/** Rate limit window in milliseconds (1 minute) */
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Maximum auth attempts per window (per user) */
const MAX_AUTH_ATTEMPTS_PER_WINDOW = 10;

/** Maximum auth attempts per window (per IP address) */
const MAX_AUTH_ATTEMPTS_PER_IP = 20;

export type DeletionStatus = 'pending' | 'in_progress' | 'completed';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

export interface UserDataService {
  /** Log an authentication event */
  logAuthEvent(event: AuthEvent): Promise<void>;

  /** Get recent auth events for a user (session activity view) */
  getAuthEvents(userId: string, limit: number): Promise<AuthEvent[]>;

  /** Check if an auth action is rate-limited (passive check) */
  isRateLimited(userId: string): Promise<boolean>;

  /**
   * Check if an auth action is rate-limited by IP address.
   * Prevents distributed brute-force attacks (Req 13.5).
   */
  isIpRateLimited(ipAddress: string): Promise<boolean>;

  /**
   * Enforce rate limiting before an auth attempt.
   * Checks both user-based and IP-based limits.
   * Returns { allowed: false, retryAfterMs } if blocked.
   * This MUST be called before processing any authentication request.
   */
  enforceRateLimit(userId: string, ipAddress: string): Promise<RateLimitResult>;

  /** Delete user account: erase local data immediately, schedule server deletion */
  deleteUserAccount(userId: string): Promise<DeletionReceipt>;

  /** Get the status of a pending account deletion */
  getDeletionStatus(userId: string): Promise<DeletionStatus>;
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface UserDataServiceConfig {
  db: DatabaseDriver;
  /** Optional HTTP client for server-side deletion requests */
  httpClient?: {
    delete<T>(url: string): Promise<{ data: T }>;
    get<T>(url: string): Promise<{ data: T }>;
  };
}

/**
 * Creates a UserDataService instance.
 */
export function createUserDataService(
  config: UserDataServiceConfig,
): UserDataService {
  const { db, httpClient } = config;

  async function logAuthEvent(event: AuthEvent): Promise<void> {
    await db.execute(
      `INSERT INTO auth_events (id, user_id, event_type, platform, ip_address, user_agent, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.userId,
        event.eventType,
        event.platform,
        event.ipAddress,
        event.userAgent,
        event.timestamp.getTime(),
      ],
    );
  }

  async function getAuthEvents(
    userId: string,
    limit: number,
  ): Promise<AuthEvent[]> {
    const rows = await db.query<{
      id: string;
      user_id: string;
      event_type: string;
      platform: string;
      ip_address: string;
      user_agent: string;
      timestamp: number;
    }>(
      'SELECT * FROM auth_events WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?',
      [userId, limit],
    );

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      eventType: row.event_type as AuthEvent['eventType'],
      platform: row.platform as AuthEvent['platform'],
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      timestamp: new Date(row.timestamp),
    }));
  }

  async function isRateLimited(userId: string): Promise<boolean> {
    const windowStart = Date.now() - RATE_LIMIT_WINDOW_MS;

    const rows = await db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM auth_events
       WHERE user_id = ? AND event_type = 'login' AND timestamp > ?`,
      [userId, windowStart],
    );

    const count = rows.length > 0 ? rows[0].cnt : 0;
    return count >= MAX_AUTH_ATTEMPTS_PER_WINDOW;
  }

  async function isIpRateLimited(ipAddress: string): Promise<boolean> {
    const windowStart = Date.now() - RATE_LIMIT_WINDOW_MS;

    const rows = await db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM auth_events
       WHERE ip_address = ? AND event_type = 'login' AND timestamp > ?`,
      [ipAddress, windowStart],
    );

    const count = rows.length > 0 ? rows[0].cnt : 0;
    return count >= MAX_AUTH_ATTEMPTS_PER_IP;
  }

  async function enforceRateLimit(
    userId: string,
    ipAddress: string,
  ): Promise<RateLimitResult> {
    const userLimited = await isRateLimited(userId);
    if (userLimited) {
      return { allowed: false, retryAfterMs: RATE_LIMIT_WINDOW_MS };
    }

    const ipLimited = await isIpRateLimited(ipAddress);
    if (ipLimited) {
      return { allowed: false, retryAfterMs: RATE_LIMIT_WINDOW_MS };
    }

    return { allowed: true };
  }

  async function deleteUserAccount(userId: string): Promise<DeletionReceipt> {
    const requestedAt = new Date();
    const scheduledCompletionAt = new Date(
      requestedAt.getTime() + MAX_DELETION_DAYS * 24 * 60 * 60 * 1000,
    );

    // Step 1: Erase local data immediately
    // Delete all events for user's calendar accounts (CASCADE handles sync_queue, privacy, overrides)
    await db.execute(
      `DELETE FROM calendar_accounts WHERE user_id = ?`,
      [userId],
    );

    // Delete auth events
    await db.execute(
      `DELETE FROM auth_events WHERE user_id = ?`,
      [userId],
    );

    // Delete scheduling preferences
    await db.execute(
      `DELETE FROM scheduling_preferences WHERE user_id = ?`,
      [userId],
    );

    // Delete subscription record
    await db.execute(
      `DELETE FROM user_subscription WHERE user_id = ?`,
      [userId],
    );

    // Delete onboarding state
    await db.execute(
      `DELETE FROM onboarding_state WHERE user_id = ?`,
      [userId],
    );

    // Delete shared views owned by user
    await db.execute(
      `DELETE FROM shared_view_members WHERE view_id IN (SELECT id FROM shared_views WHERE owner_id = ?)`,
      [userId],
    );
    await db.execute(
      `DELETE FROM shared_views WHERE owner_id = ?`,
      [userId],
    );

    // Revoke all delegation grants (as delegator or delegate)
    const now = Date.now();
    await db.execute(
      `UPDATE delegation_grants SET revoked_at = ? WHERE (delegator_id = ? OR delegate_id = ?) AND revoked_at IS NULL`,
      [now, userId, userId],
    );

    // Delete deletion requests for this user (clean slate)
    await db.execute(
      `DELETE FROM deletion_requests WHERE user_id = ?`,
      [userId],
    );

    // Step 2: Record deletion request for server-side processing
    const deletionId = generateUUID();
    await db.execute(
      `INSERT INTO deletion_requests (id, user_id, requested_at, scheduled_completion_at, status)
       VALUES (?, ?, ?, ?, ?)`,
      [
        deletionId,
        userId,
        requestedAt.getTime(),
        scheduledCompletionAt.getTime(),
        'pending',
      ],
    );

    // Step 3: If HTTP client available, notify server
    if (httpClient) {
      try {
        await httpClient.delete(`/users/${userId}`);
      } catch {
        // Server notification is best-effort — local deletion already complete
      }
    }

    return {
      userId,
      requestedAt,
      scheduledCompletionAt,
      status: 'pending',
    };
  }

  async function getDeletionStatus(userId: string): Promise<DeletionStatus> {
    const rows = await db.query<{ status: string }>(
      'SELECT status FROM deletion_requests WHERE user_id = ? ORDER BY requested_at DESC LIMIT 1',
      [userId],
    );

    if (rows.length === 0) {
      // No deletion request found — check if user data exists
      const userRows = await db.query<{ user_id: string }>(
        'SELECT user_id FROM user_subscription WHERE user_id = ?',
        [userId],
      );
      if (userRows.length === 0) {
        return 'completed';
      }
      return 'pending';
    }

    return rows[0].status as DeletionStatus;
  }

  return {
    logAuthEvent,
    getAuthEvents,
    isRateLimited,
    isIpRateLimited,
    enforceRateLimit,
    deleteUserAccount,
    getDeletionStatus,
  };
}

export { MAX_DELETION_DAYS, RATE_LIMIT_WINDOW_MS, MAX_AUTH_ATTEMPTS_PER_WINDOW, MAX_AUTH_ATTEMPTS_PER_IP };
