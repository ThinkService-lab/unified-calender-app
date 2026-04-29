/**
 * Property-based tests for shared views and delegation.
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6
 */

import fc from 'fast-check';
import { createSharedViewService, MAX_SHARED_VIEW_MEMBERS } from '../sharedViewService';
import { createDelegationService } from '../delegationService';
import { createPrivacyLayer } from '../../privacy/privacyLayer';
import type { DatabaseDriver } from '../../db/database';
import type { SharedViewService } from '../sharedViewService';
import type { DelegationService } from '../delegationService';
import { getSchemaSQL } from '../../db/schema';

// ── In-memory SQLite-like database driver for tests ──

interface StoredRow {
  [key: string]: unknown;
}

function createInMemoryDb(): DatabaseDriver {
  const tables = new Map<string, StoredRow[]>();
  const tableSchemas = new Map<string, string[]>();

  return {
    async execute(sql: string, params?: unknown[]): Promise<void> {
      const trimmed = sql.trim();

      // Handle CREATE TABLE
      if (trimmed.startsWith('CREATE TABLE')) {
        const match = trimmed.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/i);
        if (match) {
          const tableName = match[1];
          if (!tables.has(tableName)) {
            tables.set(tableName, []);
          }
        }
        return;
      }

      // Handle CREATE INDEX (no-op)
      if (trimmed.startsWith('CREATE INDEX') || trimmed.startsWith('PRAGMA')) {
        return;
      }

      // Handle INSERT
      if (trimmed.startsWith('INSERT INTO')) {
        const match = trimmed.match(/INSERT INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
        if (match) {
          const tableName = match[1];
          const columns = match[2].split(',').map((c) => c.trim());
          const row: StoredRow = {};
          columns.forEach((col, i) => {
            row[col] = params ? params[i] : null;
          });

          if (!tables.has(tableName)) {
            tables.set(tableName, []);
          }

          // Handle ON CONFLICT DO UPDATE
          if (trimmed.includes('ON CONFLICT')) {
            const conflictMatch = trimmed.match(/ON CONFLICT\(([^)]+)\)/i);
            if (conflictMatch) {
              const conflictCols = conflictMatch[1].split(',').map((c) => c.trim());
              const tableRows = tables.get(tableName)!;
              const existingIdx = tableRows.findIndex((r) =>
                conflictCols.every((col) => r[col] === row[col]),
              );
              if (existingIdx >= 0) {
                // Update existing row
                Object.assign(tableRows[existingIdx], row);
                return;
              }
            }
          }

          tables.get(tableName)!.push(row);
        }
        return;
      }

      // Handle UPDATE
      if (trimmed.startsWith('UPDATE')) {
        const match = trimmed.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(.+)/is);
        if (match) {
          const tableName = match[1];
          const setClause = match[2];
          const whereClause = match[3];
          const tableRows = tables.get(tableName) || [];

          // Parse SET clause
          const setParts = setClause.split(',').map((s) => s.trim());
          const setColumns: string[] = [];
          for (const part of setParts) {
            const colMatch = part.match(/(\w+)\s*=\s*\?/);
            if (colMatch) {
              setColumns.push(colMatch[1]);
            }
          }

          // Parse WHERE clause to find matching rows
          const whereColumns: string[] = [];
          const whereParts = whereClause.split(/\s+AND\s+/i);
          for (const part of whereParts) {
            const colMatch = part.match(/(\w+)\s*=\s*\?/);
            if (colMatch) {
              whereColumns.push(colMatch[1]);
            }
            // Handle IS NULL
            const nullMatch = part.match(/(\w+)\s+IS\s+NULL/i);
            if (nullMatch) {
              whereColumns.push(`${nullMatch[1]}__isnull`);
            }
            // Handle IN clause
            const inMatch = part.match(/(\w+)\s+IN\s+\(/i);
            if (inMatch) {
              whereColumns.push(`${inMatch[1]}__in`);
            }
          }

          // params: first N are SET values, remaining are WHERE values
          const setParams = params ? params.slice(0, setColumns.length) : [];
          const whereParams = params ? params.slice(setColumns.length) : [];

          let whereParamIdx = 0;
          for (const row of tableRows) {
            let matches = true;
            whereParamIdx = 0;
            for (const wc of whereColumns) {
              if (wc.endsWith('__isnull')) {
                const col = wc.replace('__isnull', '');
                if (row[col] !== null && row[col] !== undefined) {
                  matches = false;
                  break;
                }
              } else if (wc.endsWith('__in')) {
                // Skip IN clause matching for simplicity
              } else {
                if (row[wc] !== whereParams[whereParamIdx]) {
                  matches = false;
                  break;
                }
                whereParamIdx++;
              }
            }

            if (matches) {
              setColumns.forEach((col, i) => {
                row[col] = setParams[i];
              });
            }
          }
        }
        return;
      }

      // Handle DELETE
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
          // Simple WHERE col = ? matching
          const whereColumns: string[] = [];
          const whereParts = whereClause.split(/\s+AND\s+/i);
          for (const part of whereParts) {
            const colMatch = part.match(/(\w+)\s*=\s*\?/);
            if (colMatch) {
              whereColumns.push(colMatch[1]);
            }
            // Handle IN (SELECT ...) — just use first param
            const inSelectMatch = part.match(/(\w+)\s+IN\s+\(SELECT/i);
            if (inSelectMatch) {
              // For simplicity, skip subquery-based deletes
            }
          }

          if (whereColumns.length > 0 && params) {
            const filtered = tableRows.filter((row) => {
              return !whereColumns.every((col, i) => row[col] === params[i]);
            });
            tables.set(tableName, filtered);
          }
        }
        return;
      }
    },

    async query<T = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<T[]> {
      const trimmed = sql.trim();

      // Handle COUNT(*)
      if (trimmed.includes('COUNT(*)')) {
        const match = trimmed.match(/FROM\s+(\w+)(?:\s+WHERE\s+(.+))?/i);
        if (match) {
          const tableName = match[1];
          const whereClause = match[2];
          const tableRows = tables.get(tableName) || [];

          if (!whereClause) {
            return [{ cnt: tableRows.length } as unknown as T];
          }

          // Simple WHERE col = ? matching
          const whereColumns: string[] = [];
          const whereParts = whereClause.split(/\s+AND\s+/i);
          for (const part of whereParts) {
            const colMatch = part.match(/(\w+)\s*=\s*\?/);
            if (colMatch) {
              whereColumns.push(colMatch[1]);
            }
          }

          const filtered = tableRows.filter((row) =>
            whereColumns.every((col, i) => row[col] === (params ? params[i] : undefined)),
          );
          return [{ cnt: filtered.length } as unknown as T];
        }
      }

      // Handle SELECT
      const match = trimmed.match(/FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+.+?)?(?:\s+LIMIT\s+\?)?$/i);
      if (match) {
        const tableName = match[1];
        const whereClause = match[2];
        const tableRows = tables.get(tableName) || [];

        if (!whereClause) {
          return [...tableRows] as T[];
        }

        // Parse WHERE conditions
        const conditions: Array<{ col: string; type: 'eq' | 'isnull' | 'gt' | 'in' }> = [];
        const whereParts = whereClause.split(/\s+AND\s+/i);
        for (const part of whereParts) {
          const eqMatch = part.match(/(\w+)\s*=\s*\?/);
          if (eqMatch) {
            conditions.push({ col: eqMatch[1], type: 'eq' });
            continue;
          }
          const nullMatch = part.match(/(\w+)\s+IS\s+NULL/i);
          if (nullMatch) {
            conditions.push({ col: nullMatch[1], type: 'isnull' });
            continue;
          }
          const gtMatch = part.match(/(\w+)\s*>\s*\?/);
          if (gtMatch) {
            conditions.push({ col: gtMatch[1], type: 'gt' });
            continue;
          }
          const inMatch = part.match(/(\w+)\s+IN\s+\(/i);
          if (inMatch) {
            conditions.push({ col: inMatch[1], type: 'in' });
            continue;
          }
        }

        let paramIdx = 0;
        const filtered = tableRows.filter((row) => {
          let localIdx = paramIdx;
          let matches = true;
          for (const cond of conditions) {
            if (cond.type === 'eq') {
              if (row[cond.col] !== (params ? params[localIdx] : undefined)) {
                matches = false;
              }
              localIdx++;
            } else if (cond.type === 'isnull') {
              if (row[cond.col] !== null && row[cond.col] !== undefined) {
                matches = false;
              }
            } else if (cond.type === 'gt') {
              if (!((row[cond.col] as number) > (params ? (params[localIdx] as number) : 0))) {
                matches = false;
              }
              localIdx++;
            } else if (cond.type === 'in') {
              // For IN clauses, check if value is in remaining params
              const inValues = params ? params.slice(localIdx) : [];
              if (!inValues.includes(row[cond.col])) {
                matches = false;
              }
            }
          }
          return matches;
        });

        // Handle ORDER BY ... DESC and LIMIT
        let result = [...filtered];
        if (trimmed.includes('ORDER BY') && trimmed.includes('DESC')) {
          const orderMatch = trimmed.match(/ORDER BY\s+(\w+)\s+DESC/i);
          if (orderMatch) {
            const orderCol = orderMatch[1];
            result.sort((a, b) => (b[orderCol] as number) - (a[orderCol] as number));
          }
        }

        if (trimmed.includes('LIMIT')) {
          // LIMIT param is the last param
          const limitParam = params ? params[params.length - 1] : 100;
          result = result.slice(0, limitParam as number);
        }

        return result as T[];
      }

      return [] as T[];
    },

    async close(): Promise<void> {},
    isOpen(): boolean {
      return true;
    },
  };
}

async function setupDb(db: DatabaseDriver): Promise<void> {
  const statements = getSchemaSQL();
  for (const sql of statements) {
    await db.execute(sql);
  }
}

async function seedCalendarAccount(
  db: DatabaseDriver,
  accountId: string,
  userId: string,
): Promise<void> {
  await db.execute(
    `INSERT INTO calendar_accounts (id, user_id, provider_id, display_name, email, color, visibility, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [accountId, userId, 'google', 'Test Calendar', 'test@test.com', '#4285F4', 'public', 'active', Date.now()],
  );
}

async function seedEvent(
  db: DatabaseDriver,
  eventId: string,
  calendarAccountId: string,
  title: string,
): Promise<void> {
  const now = Date.now();
  await db.execute(
    `INSERT INTO events (id, provider_event_id, calendar_account_id, title, description, location,
      start_time, end_time, time_zone, is_all_day, sequence, dtstamp, status,
      sync_status, local_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [eventId, '', calendarAccountId, title, null, null,
      now, now + 3600000, 'UTC', 0, 0, now, 'confirmed',
      'synced', 1, now, now],
  );
}

// ── Custom Arbitraries ──

/** Generate a delegation grant with random permission */
function arbDelegationGrant(): fc.Arbitrary<{
  delegatorId: string;
  delegateId: string;
  calendarIds: string[];
  permission: 'read-only' | 'read-write';
}> {
  return fc.record({
    delegatorId: fc.string({ minLength: 1, maxLength: 10 }).map((s) => `delegator-${s.replace(/[^a-z0-9]/gi, 'x')}`),
    delegateId: fc.string({ minLength: 1, maxLength: 10 }).map((s) => `delegate-${s.replace(/[^a-z0-9]/gi, 'x')}`),
    calendarIds: fc.constant(['cal-1']),
    permission: fc.constantFrom('read-only' as const, 'read-write' as const),
  });
}

/** Generate a valid auth event type */
function arbEventType(): fc.Arbitrary<'login' | 'logout' | 'token_refresh' | 'token_revoked' | 'password_change'> {
  return fc.constantFrom('login', 'logout', 'token_refresh', 'token_revoked', 'password_change');
}

/** Generate a valid platform */
function arbPlatform(): fc.Arbitrary<'ios' | 'android' | 'web'> {
  return fc.constantFrom('ios', 'android', 'web');
}

describe('Sharing & Delegation Property Tests', () => {
  // Feature: unified-calendar-app, Property 21: Delegation permission enforcement
  // **Validates: Requirements 14.2, 14.3, 14.5**
  describe('Property 21: Delegation permission enforcement', () => {
    it('read-write allows CRUD, read-only rejects writes, revoked rejects all', () => {
      fc.assert(
        fc.asyncProperty(arbDelegationGrant(), async (grant) => {
          const db = createInMemoryDb();
          await setupDb(db);
          await seedCalendarAccount(db, 'cal-1', grant.delegatorId);
          await seedEvent(db, 'event-1', 'cal-1', 'Test Event');

          const service = createDelegationService({ db });

          // Grant delegation
          const grantResult = await service.grantDelegation(
            grant.delegatorId,
            grant.delegateId,
            grant.calendarIds,
            grant.permission,
          );
          expect(grantResult.success).toBe(true);

          // Test read — both permissions allow reads
          const canRead = await service.canPerformOperation(
            grant.delegateId,
            'cal-1',
            'read',
          );
          expect(canRead).toBe(true);

          if (grant.permission === 'read-write') {
            // Read-write: all CRUD operations should succeed
            const canCreate = await service.canPerformOperation(grant.delegateId, 'cal-1', 'create');
            const canUpdate = await service.canPerformOperation(grant.delegateId, 'cal-1', 'update');
            const canDelete = await service.canPerformOperation(grant.delegateId, 'cal-1', 'delete');
            expect(canCreate).toBe(true);
            expect(canUpdate).toBe(true);
            expect(canDelete).toBe(true);
          } else {
            // Read-only: write operations should be rejected
            const canCreate = await service.canPerformOperation(grant.delegateId, 'cal-1', 'create');
            const canUpdate = await service.canPerformOperation(grant.delegateId, 'cal-1', 'update');
            const canDelete = await service.canPerformOperation(grant.delegateId, 'cal-1', 'delete');
            expect(canCreate).toBe(false);
            expect(canUpdate).toBe(false);
            expect(canDelete).toBe(false);
          }

          // Revoke delegation
          const revokeResult = await service.revokeDelegation(grantResult.grantId!);
          expect(revokeResult.success).toBe(true);

          // After revocation: all operations should be rejected
          const canReadAfter = await service.canPerformOperation(grant.delegateId, 'cal-1', 'read');
          const canCreateAfter = await service.canPerformOperation(grant.delegateId, 'cal-1', 'create');
          const canUpdateAfter = await service.canPerformOperation(grant.delegateId, 'cal-1', 'update');
          const canDeleteAfter = await service.canPerformOperation(grant.delegateId, 'cal-1', 'delete');
          expect(canReadAfter).toBe(false);
          expect(canCreateAfter).toBe(false);
          expect(canUpdateAfter).toBe(false);
          expect(canDeleteAfter).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });

  // Feature: unified-calendar-app, Property 22: Delegate modification audit trail
  // **Validates: Requirements 14.4**
  describe('Property 22: Delegate modification audit trail', () => {
    it('modifiedBy contains delegate user ID after delegate modification', () => {
      fc.assert(
        fc.asyncProperty(
          fc.record({
            delegateId: fc.string({ minLength: 1, maxLength: 10 }).map((s) => `delegate-${s.replace(/[^a-z0-9]/gi, 'x')}`),
            newTitle: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
          }),
          async ({ delegateId, newTitle }) => {
            const db = createInMemoryDb();
            await setupDb(db);
            await seedCalendarAccount(db, 'cal-1', 'owner-1');
            await seedEvent(db, 'event-1', 'cal-1', 'Original Title');

            const service = createDelegationService({ db });

            // Grant read-write delegation
            await service.grantDelegation('owner-1', delegateId, ['cal-1'], 'read-write');

            // Update event as delegate
            const updateResult = await service.updateEventAsDelegate(
              delegateId,
              'event-1',
              { title: newTitle },
            );
            expect(updateResult.success).toBe(true);

            // Verify modifiedBy contains delegate's user ID
            const rows = await db.query<{ modified_by: string }>(
              'SELECT modified_by FROM events WHERE id = ?',
              ['event-1'],
            );
            expect(rows.length).toBe(1);
            expect(rows[0].modified_by).toBe(delegateId);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: unified-calendar-app, Property 23: Shared view member limit enforcement
  // **Validates: Requirements 14.6**
  describe('Property 23: Shared view member limit enforcement', () => {
    it('adding member when count = 20 is rejected', () => {
      fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 5 }).map((n) => n + MAX_SHARED_VIEW_MEMBERS),
          async (attemptedTotal) => {
            const db = createInMemoryDb();
            await setupDb(db);

            const privacyLayer = createPrivacyLayer(db);
            const service = createSharedViewService({
              db,
              privacyLayer,
              checkTeamAccess: () => true,
            });

            // Create a shared view
            const viewResult = await service.createSharedView('owner-1', 'Team View', ['cal-1']);
            expect(viewResult.success).toBe(true);
            const viewId = viewResult.viewId!;

            // Add exactly MAX_SHARED_VIEW_MEMBERS members
            for (let i = 0; i < MAX_SHARED_VIEW_MEMBERS; i++) {
              const addResult = await service.addMember(viewId, {
                userId: `member-${i}`,
                permission: 'read-only',
              });
              expect(addResult.success).toBe(true);
            }

            // Attempt to add one more — should be rejected
            const overflowResult = await service.addMember(viewId, {
              userId: `member-overflow`,
              permission: 'read-only',
            });
            expect(overflowResult.success).toBe(false);
            expect(overflowResult.error).toContain('limit');
          },
        ),
        { numRuns: 10 }, // Fewer runs since each iteration adds 20 members
      );
    });
  });
});
