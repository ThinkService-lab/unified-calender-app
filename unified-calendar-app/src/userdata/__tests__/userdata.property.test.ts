/**
 * Property-based tests for UserDataService — auth event logging and account deletion.
 * Requirements: 13.4, 13.6
 */

import fc from 'fast-check';
import { createUserDataService, MAX_DELETION_DAYS } from '../userDataService';
import type { UserDataService } from '../userDataService';
import type { DatabaseDriver } from '../../db/database';
import type { AuthEvent } from '../../types';
import { getSchemaSQL } from '../../db/schema';

// ── In-memory SQLite-like database driver for tests ──

interface StoredRow {
  [key: string]: unknown;
}

function createInMemoryDb(): DatabaseDriver {
  const tables = new Map<string, StoredRow[]>();

  return {
    async execute(sql: string, params?: unknown[]): Promise<void> {
      const trimmed = sql.trim();

      if (trimmed.startsWith('CREATE TABLE') || trimmed.startsWith('CREATE INDEX') || trimmed.startsWith('PRAGMA')) {
        if (trimmed.startsWith('CREATE TABLE')) {
          const match = trimmed.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/i);
          if (match && !tables.has(match[1])) {
            tables.set(match[1], []);
          }
        }
        return;
      }

      if (trimmed.startsWith('INSERT INTO')) {
        const match = trimmed.match(/INSERT INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
        if (match) {
          const tableName = match[1];
          const columns = match[2].split(',').map((c) => c.trim());
          const row: StoredRow = {};
          columns.forEach((col, i) => {
            row[col] = params ? params[i] : null;
          });
          if (!tables.has(tableName)) tables.set(tableName, []);

          if (trimmed.includes('ON CONFLICT')) {
            const conflictMatch = trimmed.match(/ON CONFLICT\(([^)]+)\)/i);
            if (conflictMatch) {
              const conflictCols = conflictMatch[1].split(',').map((c) => c.trim());
              const tableRows = tables.get(tableName)!;
              const existingIdx = tableRows.findIndex((r) =>
                conflictCols.every((col) => r[col] === row[col]),
              );
              if (existingIdx >= 0) {
                Object.assign(tableRows[existingIdx], row);
                return;
              }
            }
          }

          tables.get(tableName)!.push(row);
        }
        return;
      }

      if (trimmed.startsWith('UPDATE')) {
        const match = trimmed.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(.+)/is);
        if (match) {
          const tableName = match[1];
          const setClause = match[2];
          const whereClause = match[3];
          const tableRows = tables.get(tableName) || [];

          const setParts = setClause.split(',').map((s) => s.trim());
          const setColumns: string[] = [];
          for (const part of setParts) {
            const colMatch = part.match(/(\w+)\s*=\s*\?/);
            if (colMatch) setColumns.push(colMatch[1]);
          }

          const whereColumns: string[] = [];
          const whereParts = whereClause.split(/\s+AND\s+/i);
          for (const part of whereParts) {
            const colMatch = part.match(/(\w+)\s*=\s*\?/);
            if (colMatch) whereColumns.push(colMatch[1]);
            const nullMatch = part.match(/(\w+)\s+IS\s+NULL/i);
            if (nullMatch) whereColumns.push(`${nullMatch[1]}__isnull`);
          }

          const setParams = params ? params.slice(0, setColumns.length) : [];
          const whereParams = params ? params.slice(setColumns.length) : [];

          for (const row of tableRows) {
            let matches = true;
            let wpIdx = 0;
            for (const wc of whereColumns) {
              if (wc.endsWith('__isnull')) {
                const col = wc.replace('__isnull', '');
                if (row[col] !== null && row[col] !== undefined) matches = false;
              } else {
                if (row[wc] !== whereParams[wpIdx]) matches = false;
                wpIdx++;
              }
            }
            if (matches) {
              setColumns.forEach((col, i) => { row[col] = setParams[i]; });
            }
          }
        }
        return;
      }

      if (trimmed.startsWith('DELETE FROM')) {
        const match = trimmed.match(/DELETE FROM\s+(\w+)(?:\s+WHERE\s+(.+))?/is);
        if (match) {
          const tableName = match[1];
          const whereClause = match[2];
          if (!whereClause) {
            tables.set(tableName, []);
            return;
          }

          const tableRows = tables.get(tableName) || [];
          const whereColumns: string[] = [];
          const whereParts = whereClause.split(/\s+AND\s+/i);
          for (const part of whereParts) {
            const colMatch = part.match(/(\w+)\s*=\s*\?/);
            if (colMatch) whereColumns.push(colMatch[1]);
          }

          if (whereColumns.length > 0 && params) {
            const filtered = tableRows.filter((row) =>
              !whereColumns.every((col, i) => row[col] === params[i]),
            );
            tables.set(tableName, filtered);
          }
        }
        return;
      }
    },

    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      const trimmed = sql.trim();

      if (trimmed.includes('COUNT(*)')) {
        const match = trimmed.match(/FROM\s+(\w+)(?:\s+WHERE\s+(.+))?/i);
        if (match) {
          const tableName = match[1];
          const whereClause = match[2];
          const tableRows = tables.get(tableName) || [];
          if (!whereClause) return [{ cnt: tableRows.length } as unknown as T];

          const whereColumns: string[] = [];
          const whereParts = whereClause.split(/\s+AND\s+/i);
          for (const part of whereParts) {
            const colMatch = part.match(/(\w+)\s*=\s*\?/);
            if (colMatch) whereColumns.push(colMatch[1]);
          }
          const filtered = tableRows.filter((row) =>
            whereColumns.every((col, i) => row[col] === (params ? params[i] : undefined)),
          );
          return [{ cnt: filtered.length } as unknown as T];
        }
      }

      const match = trimmed.match(/FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+.+?)?(?:\s+LIMIT\s+\?)?$/i);
      if (match) {
        const tableName = match[1];
        const whereClause = match[2];
        const tableRows = tables.get(tableName) || [];

        if (!whereClause) return [...tableRows] as T[];

        const conditions: Array<{ col: string; type: 'eq' | 'gt' }> = [];
        const whereParts = whereClause.split(/\s+AND\s+/i);
        for (const part of whereParts) {
          const eqMatch = part.match(/(\w+)\s*=\s*\?/);
          if (eqMatch) { conditions.push({ col: eqMatch[1], type: 'eq' }); continue; }
          const gtMatch = part.match(/(\w+)\s*>\s*\?/);
          if (gtMatch) { conditions.push({ col: gtMatch[1], type: 'gt' }); continue; }
        }

        let paramIdx = 0;
        const filtered = tableRows.filter((row) => {
          let localIdx = 0;
          let matches = true;
          for (const cond of conditions) {
            if (cond.type === 'eq') {
              if (row[cond.col] !== (params ? params[localIdx] : undefined)) matches = false;
              localIdx++;
            } else if (cond.type === 'gt') {
              if (!((row[cond.col] as number) > (params ? (params[localIdx] as number) : 0))) matches = false;
              localIdx++;
            }
          }
          return matches;
        });

        let result = [...filtered];
        if (trimmed.includes('ORDER BY') && trimmed.includes('DESC')) {
          const orderMatch = trimmed.match(/ORDER BY\s+(\w+)\s+DESC/i);
          if (orderMatch) {
            const orderCol = orderMatch[1];
            result.sort((a, b) => (b[orderCol] as number) - (a[orderCol] as number));
          }
        }
        if (trimmed.includes('LIMIT')) {
          const limitParam = params ? params[params.length - 1] : 100;
          result = result.slice(0, limitParam as number);
        }

        return result as T[];
      }

      return [] as T[];
    },

    async close(): Promise<void> {},
    isOpen(): boolean { return true; },
  };
}

async function setupDb(db: DatabaseDriver): Promise<void> {
  const statements = getSchemaSQL();
  for (const sql of statements) {
    await db.execute(sql);
  }
}

// ── Custom Arbitraries ──

function arbAuthEvent(userId: string): fc.Arbitrary<AuthEvent> {
  return fc.record({
    id: fc.uuid(),
    userId: fc.constant(userId),
    eventType: fc.constantFrom(
      'login' as const,
      'logout' as const,
      'token_refresh' as const,
      'token_revoked' as const,
      'password_change' as const,
    ),
    platform: fc.constantFrom('ios' as const, 'android' as const, 'web' as const),
    ipAddress: fc.ipV4(),
    userAgent: fc.string({ minLength: 1, maxLength: 50 }),
    timestamp: fc.date({
      min: new Date('2024-01-01'),
      max: new Date('2026-01-01'),
    }),
  });
}

describe('UserDataService Property Tests', () => {
  // Feature: unified-calendar-app, Property 31: Auth event logging completeness
  // **Validates: Requirements 13.6**
  describe('Property 31: Auth event logging completeness', () => {
    it('each auth action creates exactly one AuthEvent with correct eventType, platform, timestamp', () => {
      fc.assert(
        fc.asyncProperty(arbAuthEvent('user-1'), async (authEvent) => {
          const db = createInMemoryDb();
          await setupDb(db);

          const service = createUserDataService({ db });

          // Log the auth event
          await service.logAuthEvent(authEvent);

          // Retrieve auth events
          const events = await service.getAuthEvents('user-1', 100);

          // Exactly one event should exist
          expect(events.length).toBe(1);

          const logged = events[0];
          expect(logged.id).toBe(authEvent.id);
          expect(logged.eventType).toBe(authEvent.eventType);
          expect(logged.platform).toBe(authEvent.platform);
          expect(logged.timestamp.getTime()).toBe(authEvent.timestamp.getTime());
          expect(logged.userId).toBe(authEvent.userId);
          expect(logged.ipAddress).toBe(authEvent.ipAddress);
        }),
        { numRuns: 100 },
      );
    });
  });

  // Feature: unified-calendar-app, Property 30: Server-side data deletion completeness
  // **Validates: Requirements 13.4**
  describe('Property 30: Server-side data deletion completeness', () => {
    it('scheduledCompletionAt ≤ 30 days, zero records after completion', () => {
      fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 10 }).map((s) => `user-${s.replace(/[^a-z0-9]/gi, 'x')}`),
          async (userId) => {
            const db = createInMemoryDb();
            await setupDb(db);

            // Seed some user data
            await db.execute(
              `INSERT INTO user_subscription (user_id, tier, platform, connected_account_count)
               VALUES (?, ?, ?, ?)`,
              [userId, 'pro', 'stripe', 2],
            );

            await db.execute(
              `INSERT INTO calendar_accounts (id, user_id, provider_id, display_name, email, color, visibility, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [`cal-${userId}`, userId, 'google', 'Test', 'test@test.com', '#000', 'public', 'active', Date.now()],
            );

            await db.execute(
              `INSERT INTO auth_events (id, user_id, event_type, platform, ip_address, user_agent, timestamp)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [`auth-${userId}`, userId, 'login', 'web', '1.2.3.4', 'test', Date.now()],
            );

            const service = createUserDataService({ db });

            // Delete user account
            const receipt = await service.deleteUserAccount(userId);

            // Verify scheduledCompletionAt ≤ 30 days from requestedAt
            const daysDiff =
              (receipt.scheduledCompletionAt.getTime() - receipt.requestedAt.getTime()) /
              (24 * 60 * 60 * 1000);
            expect(daysDiff).toBeLessThanOrEqual(MAX_DELETION_DAYS);
            expect(daysDiff).toBeGreaterThan(0);

            // Verify status is pending
            expect(receipt.status).toBe('pending');

            // Verify local data is erased
            const accounts = await db.query(
              'SELECT * FROM calendar_accounts WHERE user_id = ?',
              [userId],
            );
            expect(accounts.length).toBe(0);

            const authEvents = await db.query(
              'SELECT * FROM auth_events WHERE user_id = ?',
              [userId],
            );
            expect(authEvents.length).toBe(0);

            const subscriptions = await db.query(
              'SELECT * FROM user_subscription WHERE user_id = ?',
              [userId],
            );
            expect(subscriptions.length).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
