/**
 * Unit tests for SQLite schema and database initialization.
 * Requirements: 6.1, 6.4, 6.6, 17.1
 */

import initSqlJs, { type Database } from 'sql.js';
import { getSchemaSQL, SCHEMA_VERSION, CREATE_TABLES_SQL, CREATE_INDEXES_SQL } from '../schema';
import { initializeSchema, getSchemaVersion, verifySchema } from '../database';
import type { DatabaseDriver } from '../database';

/**
 * Creates an in-memory sql.js backed DatabaseDriver for testing.
 */
async function createTestDriver(): Promise<DatabaseDriver & { rawDb: Database }> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  let isDbOpen = true;

  const driver: DatabaseDriver & { rawDb: Database } = {
    rawDb: db,
    async execute(sql: string, params?: unknown[]): Promise<void> {
      db.run(sql, params as any[]);
    },
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      const stmt = db.prepare(sql);
      if (params) {
        stmt.bind(params as any[]);
      }
      const results: T[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject() as T);
      }
      stmt.free();
      return results;
    },
    async close(): Promise<void> {
      db.close();
      isDbOpen = false;
    },
    isOpen(): boolean {
      return isDbOpen;
    },
    supportsTransactions: true,
    async transaction<T>(fn: (tx: { execute: DatabaseDriver['execute']; query: DatabaseDriver['query'] }) => Promise<T>): Promise<T> {
      db.run('BEGIN TRANSACTION');
      try {
        const result = await fn({ execute: driver.execute, query: driver.query });
        db.run('COMMIT');
        return result;
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
    },
  };

  return driver;
}

describe('Schema SQL generation', () => {
  it('should include all expected table creation statements', () => {
    const expectedTables = [
      'schema_version',
      'calendar_accounts',
      'events',
      'sync_queue',
      'user_subscription',
      'privacy_preferences',
      'event_visibility_overrides',
      'scheduling_preferences',
      'auth_events',
      'onboarding_state',
    ];

    const allSql = CREATE_TABLES_SQL.join('\n');
    for (const table of expectedTables) {
      expect(allSql).toContain(table);
    }
  });

  it('should include all expected indexes', () => {
    const expectedIndexes = [
      'idx_events_calendar',
      'idx_events_time',
      'idx_events_sync',
      'idx_events_provider_id',
      'idx_auth_events_user',
    ];

    const allSql = CREATE_INDEXES_SQL.join('\n');
    for (const idx of expectedIndexes) {
      expect(allSql).toContain(idx);
    }
  });

  it('should include CASCADE delete constraints on events', () => {
    const eventsSql = CREATE_TABLES_SQL.find((s) => s.includes('CREATE TABLE IF NOT EXISTS events'));
    expect(eventsSql).toContain('ON DELETE CASCADE');
  });

  it('should include CASCADE delete constraints on sync_queue', () => {
    const syncSql = CREATE_TABLES_SQL.find((s) => s.includes('CREATE TABLE IF NOT EXISTS sync_queue'));
    expect(syncSql).toContain('ON DELETE CASCADE');
  });

  it('getSchemaSQL returns tables + indexes combined', () => {
    const all = getSchemaSQL();
    expect(all.length).toBe(CREATE_TABLES_SQL.length + CREATE_INDEXES_SQL.length);
  });
});

describe('Database initialization', () => {
  let driver: DatabaseDriver & { rawDb: Database };

  beforeEach(async () => {
    driver = await createTestDriver();
  });

  afterEach(async () => {
    if (driver.isOpen()) {
      await driver.close();
    }
  });

  it('should create all tables on fresh database', async () => {
    await initializeSchema(driver);
    const isValid = await verifySchema(driver);
    expect(isValid).toBe(true);
  });

  it('should set schema version after initialization', async () => {
    await initializeSchema(driver);
    const version = await getSchemaVersion(driver);
    expect(version).toBe(SCHEMA_VERSION);
  });

  it('should not re-create tables on second initialization', async () => {
    await initializeSchema(driver);

    // Insert test data
    await driver.execute(
      "INSERT INTO calendar_accounts (id, user_id, provider_id, display_name, email, color, visibility, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ['acc-1', 'user-1', 'google', 'Test', 'test@test.com', '#ff0000', 'public', 'active', Date.now()]
    );

    // Re-initialize should not drop data
    await initializeSchema(driver);
    const rows = await driver.query<{ id: string }>('SELECT id FROM calendar_accounts');
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('acc-1');
  });

  it('should return null schema version for fresh database', async () => {
    const version = await getSchemaVersion(driver);
    expect(version).toBeNull();
  });

  it('should enforce CASCADE delete from calendar_accounts to events', async () => {
    await initializeSchema(driver);

    // Insert account
    await driver.execute(
      "INSERT INTO calendar_accounts (id, user_id, provider_id, display_name, email, color, visibility, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ['acc-1', 'user-1', 'google', 'Test', 'test@test.com', '#ff0000', 'public', 'active', Date.now()]
    );

    // Insert event referencing account
    const now = Date.now();
    await driver.execute(
      "INSERT INTO events (id, provider_event_id, calendar_account_id, title, start_time, end_time, time_zone, is_all_day, sequence, dtstamp, status, sync_status, local_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ['evt-1', 'prov-1', 'acc-1', 'Meeting', now, now + 3600000, 'UTC', 0, 0, now, 'confirmed', 'synced', 1, now, now]
    );

    // Delete account — events should cascade
    await driver.execute("DELETE FROM calendar_accounts WHERE id = ?", ['acc-1']);

    const events = await driver.query('SELECT id FROM events WHERE calendar_account_id = ?', ['acc-1']);
    expect(events.length).toBe(0);
  });

  it('should enforce CASCADE delete from calendar_accounts to sync_queue', async () => {
    await initializeSchema(driver);

    const now = Date.now();
    // Insert account
    await driver.execute(
      "INSERT INTO calendar_accounts (id, user_id, provider_id, display_name, email, color, visibility, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ['acc-1', 'user-1', 'google', 'Test', 'test@test.com', '#ff0000', 'public', 'active', now]
    );

    // Insert event
    await driver.execute(
      "INSERT INTO events (id, provider_event_id, calendar_account_id, title, start_time, end_time, time_zone, is_all_day, sequence, dtstamp, status, sync_status, local_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ['evt-1', 'prov-1', 'acc-1', 'Meeting', now, now + 3600000, 'UTC', 0, 0, now, 'confirmed', 'synced', 1, now, now]
    );

    // Insert sync queue entry
    await driver.execute(
      "INSERT INTO sync_queue (id, calendar_account_id, event_id, operation, payload, retry_count, max_retries, next_retry_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ['sq-1', 'acc-1', 'evt-1', 'create', '{}', 0, 5, now, 'pending', now]
    );

    // Delete account — sync_queue should cascade
    await driver.execute("DELETE FROM calendar_accounts WHERE id = ?", ['acc-1']);

    const queue = await driver.query('SELECT id FROM sync_queue WHERE calendar_account_id = ?', ['acc-1']);
    expect(queue.length).toBe(0);
  });

  it('should enforce CASCADE delete from events to event_visibility_overrides', async () => {
    await initializeSchema(driver);

    const now = Date.now();
    await driver.execute(
      "INSERT INTO calendar_accounts (id, user_id, provider_id, display_name, email, color, visibility, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ['acc-1', 'user-1', 'google', 'Test', 'test@test.com', '#ff0000', 'public', 'active', now]
    );

    await driver.execute(
      "INSERT INTO events (id, provider_event_id, calendar_account_id, title, start_time, end_time, time_zone, is_all_day, sequence, dtstamp, status, sync_status, local_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ['evt-1', 'prov-1', 'acc-1', 'Meeting', now, now + 3600000, 'UTC', 0, 0, now, 'confirmed', 'synced', 1, now, now]
    );

    await driver.execute(
      "INSERT INTO event_visibility_overrides (event_id, visibility) VALUES (?, ?)",
      ['evt-1', 'private']
    );

    // Delete event — visibility override should cascade
    await driver.execute("DELETE FROM events WHERE id = ?", ['evt-1']);

    const overrides = await driver.query('SELECT event_id FROM event_visibility_overrides WHERE event_id = ?', ['evt-1']);
    expect(overrides.length).toBe(0);
  });

  it('should create all indexes', async () => {
    await initializeSchema(driver);

    const indexes = await driver.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
    );
    const indexNames = indexes.map((r) => r.name);

    expect(indexNames).toContain('idx_events_calendar');
    expect(indexNames).toContain('idx_events_time');
    expect(indexNames).toContain('idx_events_sync');
    expect(indexNames).toContain('idx_events_provider_id');
    expect(indexNames).toContain('idx_auth_events_user');
  });

  it('should enforce CASCADE delete from calendar_accounts to privacy_preferences', async () => {
    await initializeSchema(driver);

    const now = Date.now();
    // Insert account
    await driver.execute(
      "INSERT INTO calendar_accounts (id, user_id, provider_id, display_name, email, color, visibility, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ['acc-1', 'user-1', 'google', 'Test', 'test@test.com', '#ff0000', 'public', 'active', now]
    );

    // Insert privacy preference for this account
    await driver.execute(
      "INSERT INTO privacy_preferences (calendar_id, visibility) VALUES (?, ?)",
      ['acc-1', 'private']
    );

    // Verify it exists
    const before = await driver.query('SELECT calendar_id FROM privacy_preferences WHERE calendar_id = ?', ['acc-1']);
    expect(before.length).toBe(1);

    // Delete account — privacy_preferences should cascade
    await driver.execute("DELETE FROM calendar_accounts WHERE id = ?", ['acc-1']);

    const after = await driver.query('SELECT calendar_id FROM privacy_preferences WHERE calendar_id = ?', ['acc-1']);
    expect(after.length).toBe(0);
  });

  it('should return false from verifySchema when tables are missing', async () => {
    // Don't initialize schema — database is empty
    const isValid = await verifySchema(driver);
    expect(isValid).toBe(false);
  });
});
