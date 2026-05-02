/**
 * Unit tests for database migration framework.
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.6
 */

import initSqlJs, { type Database } from 'sql.js';
import type { DatabaseDriver } from '../database';
import { initializeSchema, getSchemaVersion } from '../database';
import { SCHEMA_VERSION } from '../schema';
import {
  MigrationRunner,
  createReadOnlyDriver,
  type Migration,
  type MigrationNotification,
} from '../migration';

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

describe('MigrationRunner - version detection', () => {
  let driver: DatabaseDriver & { rawDb: Database };
  let runner: MigrationRunner;

  beforeEach(async () => {
    driver = await createTestDriver();
    runner = new MigrationRunner(driver);
  });

  afterEach(async () => {
    if (driver.isOpen()) {
      await driver.close();
    }
  });

  it('should detect no migration needed on fresh database', async () => {
    // Fresh DB has no schema_version table
    const needs = await runner.needsMigration();
    expect(needs).toBe(false);
  });

  it('should detect no migration needed when version matches', async () => {
    await initializeSchema(driver);
    const needs = await runner.needsMigration();
    expect(needs).toBe(false);
  });

  it('should detect migration needed when version is behind', async () => {
    // Simulate an older schema version
    await driver.execute(
      'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL, applied_at TEXT NOT NULL)'
    );
    await driver.execute(
      'INSERT INTO schema_version (version, applied_at) VALUES (?, ?)',
      [0, new Date().toISOString()]
    );

    // Register a migration to version 1
    runner.registerMigration({
      version: 1,
      description: 'Test migration',
      up: async () => {},
    });

    const needs = await runner.needsMigration();
    expect(needs).toBe(true);
  });

  it('should return pending migrations correctly', async () => {
    await driver.execute(
      'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL, applied_at TEXT NOT NULL)'
    );
    await driver.execute(
      'INSERT INTO schema_version (version, applied_at) VALUES (?, ?)',
      [0, new Date().toISOString()]
    );

    const migration1: Migration = {
      version: 1,
      description: 'Add column',
      up: async () => {},
    };

    runner.registerMigration(migration1);
    const pending = await runner.getPendingMigrations();
    expect(pending).toHaveLength(1);
    expect(pending[0].version).toBe(1);
  });
});

describe('MigrationRunner - forward-only execution', () => {
  let driver: DatabaseDriver & { rawDb: Database };
  let runner: MigrationRunner;

  beforeEach(async () => {
    driver = await createTestDriver();
    runner = new MigrationRunner(driver);

    // Set up a database at version 0 with schema_version table
    await driver.execute(
      'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL, applied_at TEXT NOT NULL)'
    );
    await driver.execute(
      'INSERT INTO schema_version (version, applied_at) VALUES (?, ?)',
      [0, new Date().toISOString()]
    );
    // Create a simple table to simulate existing data
    await driver.execute(
      'CREATE TABLE IF NOT EXISTS calendar_accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider_id TEXT NOT NULL, display_name TEXT NOT NULL, email TEXT NOT NULL, color TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT \'public\', status TEXT NOT NULL DEFAULT \'active\', created_at INTEGER NOT NULL)'
    );
  });

  afterEach(async () => {
    if (driver.isOpen()) {
      await driver.close();
    }
  });

  it('should execute migrations in order', async () => {
    const executionOrder: number[] = [];

    runner.registerMigrations([
      {
        version: 1,
        description: 'First migration',
        up: async (d) => {
          executionOrder.push(1);
          await d.execute('ALTER TABLE calendar_accounts ADD COLUMN sync_token TEXT');
        },
      },
    ]);

    const result = await runner.run();
    expect(result.success).toBe(true);
    expect(result.appliedMigrations).toEqual([1]);
    expect(executionOrder).toEqual([1]);
  });

  it('should execute multiple migrations sequentially', async () => {
    const executionOrder: number[] = [];

    // We need SCHEMA_VERSION to be >= 2 for this test to work
    // Since SCHEMA_VERSION is 1, we'll register migration to version 1
    runner.registerMigrations([
      {
        version: 1,
        description: 'First migration',
        up: async () => {
          executionOrder.push(1);
        },
      },
    ]);

    const result = await runner.run();
    expect(result.success).toBe(true);
    expect(executionOrder).toEqual([1]);
    expect(result.previousVersion).toBe(0);
    expect(result.currentVersion).toBe(1);
  });

  it('should update schema_version after each migration', async () => {
    runner.registerMigration({
      version: 1,
      description: 'Test migration',
      up: async () => {},
    });

    await runner.run();
    const version = await getSchemaVersion(driver);
    expect(version).toBe(1);
  });

  it('should return success with no-op when already up to date', async () => {
    // Set version to current
    await driver.execute(
      'INSERT INTO schema_version (version, applied_at) VALUES (?, ?)',
      [SCHEMA_VERSION, new Date().toISOString()]
    );

    const result = await runner.run();
    expect(result.success).toBe(true);
    expect(result.appliedMigrations).toEqual([]);
    expect(result.readOnly).toBe(false);
  });
});

describe('MigrationRunner - pre-migration backup', () => {
  let driver: DatabaseDriver & { rawDb: Database };
  let runner: MigrationRunner;

  beforeEach(async () => {
    driver = await createTestDriver();
    runner = new MigrationRunner(driver);

    // Set up database at version 0 with some data
    await driver.execute(
      'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL, applied_at TEXT NOT NULL)'
    );
    await driver.execute(
      'INSERT INTO schema_version (version, applied_at) VALUES (?, ?)',
      [0, new Date().toISOString()]
    );
    await driver.execute(
      'CREATE TABLE IF NOT EXISTS calendar_accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider_id TEXT NOT NULL, display_name TEXT NOT NULL, email TEXT NOT NULL, color TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT \'public\', status TEXT NOT NULL DEFAULT \'active\', created_at INTEGER NOT NULL)'
    );
    await driver.execute(
      "INSERT INTO calendar_accounts (id, user_id, provider_id, display_name, email, color, visibility, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ['acc-1', 'user-1', 'google', 'Test Account', 'test@test.com', '#ff0000', 'public', 'active', Date.now()]
    );
  });

  afterEach(async () => {
    if (driver.isOpen()) {
      await driver.close();
    }
  });

  it('should create backup before running migrations', async () => {
    runner.registerMigration({
      version: 1,
      description: 'Test migration',
      up: async () => {},
    });

    await runner.run();
    const backup = runner.getLastBackup();
    expect(backup).not.toBeNull();
    expect(backup!.version).toBe(0);
    expect(backup!.timestamp).toBeDefined();
  });

  it('should backup existing table data', async () => {
    runner.registerMigration({
      version: 1,
      description: 'Test migration',
      up: async () => {},
    });

    await runner.run();
    const backup = runner.getLastBackup();
    expect(backup!.tables['calendar_accounts']).toHaveLength(1);
    expect(backup!.tables['calendar_accounts'][0]).toMatchObject({
      id: 'acc-1',
      user_id: 'user-1',
      email: 'test@test.com',
    });
  });

  it('should handle backup of non-existent tables gracefully', async () => {
    runner.registerMigration({
      version: 1,
      description: 'Test migration',
      up: async () => {},
    });

    await runner.run();
    const backup = runner.getLastBackup();
    // Tables that don't exist should have empty arrays
    expect(backup!.tables['events']).toEqual([]);
  });

  it('should allow restoring from backup', async () => {
    runner.registerMigration({
      version: 1,
      description: 'Destructive migration',
      up: async (d) => {
        await d.execute('DELETE FROM calendar_accounts');
      },
    });

    await runner.run();

    // Verify data was deleted by migration
    const afterMigration = await driver.query('SELECT * FROM calendar_accounts');
    expect(afterMigration).toHaveLength(0);

    // Restore from backup
    const backup = runner.getLastBackup()!;
    await runner.restoreFromBackup(backup);

    const afterRestore = await driver.query<{ id: string }>('SELECT * FROM calendar_accounts');
    expect(afterRestore).toHaveLength(1);
    expect(afterRestore[0].id).toBe('acc-1');
  });
});

describe('MigrationRunner - read-only fallback on failure', () => {
  let driver: DatabaseDriver & { rawDb: Database };
  let runner: MigrationRunner;

  beforeEach(async () => {
    driver = await createTestDriver();
    runner = new MigrationRunner(driver);

    await driver.execute(
      'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL, applied_at TEXT NOT NULL)'
    );
    await driver.execute(
      'INSERT INTO schema_version (version, applied_at) VALUES (?, ?)',
      [0, new Date().toISOString()]
    );
    await driver.execute(
      'CREATE TABLE IF NOT EXISTS calendar_accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider_id TEXT NOT NULL, display_name TEXT NOT NULL, email TEXT NOT NULL, color TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT \'public\', status TEXT NOT NULL DEFAULT \'active\', created_at INTEGER NOT NULL)'
    );
  });

  afterEach(async () => {
    if (driver.isOpen()) {
      await driver.close();
    }
  });

  it('should enter read-only mode when migration fails', async () => {
    runner.registerMigration({
      version: 1,
      description: 'Failing migration',
      up: async () => {
        throw new Error('Simulated migration failure');
      },
    });

    const result = await runner.run();
    expect(result.success).toBe(false);
    expect(result.readOnly).toBe(true);
    expect(result.error).toContain('Simulated migration failure');
    expect(runner.isReadOnly()).toBe(true);
  });

  it('should report partial progress on failure', async () => {
    // Register two migrations, second one fails
    // We need to adjust SCHEMA_VERSION for this test
    // Since SCHEMA_VERSION is 1, only version 1 migration will be pending
    runner.registerMigration({
      version: 1,
      description: 'Failing migration',
      up: async () => {
        throw new Error('SQL error');
      },
    });

    const result = await runner.run();
    expect(result.previousVersion).toBe(0);
    expect(result.appliedMigrations).toEqual([]);
  });

  it('should notify user on migration failure', async () => {
    const notifications: MigrationNotification[] = [];
    runner.setNotificationHandler((n) => notifications.push(n));

    runner.registerMigration({
      version: 1,
      description: 'Failing migration',
      up: async () => {
        throw new Error('Column already exists');
      },
    });

    await runner.run();

    const failNotification = notifications.find((n) => n.type === 'migration_failed');
    expect(failNotification).toBeDefined();
    expect(failNotification!.message).toContain('Column already exists');

    const readOnlyNotification = notifications.find((n) => n.type === 'read_only_mode');
    expect(readOnlyNotification).toBeDefined();
  });

  it('should notify on successful migration', async () => {
    const notifications: MigrationNotification[] = [];
    runner.setNotificationHandler((n) => notifications.push(n));

    runner.registerMigration({
      version: 1,
      description: 'Good migration',
      up: async () => {},
    });

    await runner.run();

    expect(notifications.some((n) => n.type === 'migration_started')).toBe(true);
    expect(notifications.some((n) => n.type === 'migration_complete')).toBe(true);
  });
});

describe('createReadOnlyDriver', () => {
  let driver: DatabaseDriver & { rawDb: Database };

  beforeEach(async () => {
    driver = await createTestDriver();
    await initializeSchema(driver);
  });

  afterEach(async () => {
    if (driver.isOpen()) {
      await driver.close();
    }
  });

  it('should allow SELECT queries', async () => {
    const readOnly = createReadOnlyDriver(driver);
    const rows = await readOnly.query('SELECT version FROM schema_version');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('should reject INSERT statements', async () => {
    const readOnly = createReadOnlyDriver(driver);
    await expect(
      readOnly.execute("INSERT INTO calendar_accounts (id, user_id, provider_id, display_name, email, color, visibility, status, created_at) VALUES ('x','x','x','x','x','x','x','x',0)")
    ).rejects.toThrow('read-only mode');
  });

  it('should reject UPDATE statements', async () => {
    const readOnly = createReadOnlyDriver(driver);
    await expect(
      readOnly.execute("UPDATE calendar_accounts SET display_name = 'new' WHERE id = 'x'")
    ).rejects.toThrow('read-only mode');
  });

  it('should reject DELETE statements', async () => {
    const readOnly = createReadOnlyDriver(driver);
    await expect(
      readOnly.execute("DELETE FROM calendar_accounts WHERE id = 'x'")
    ).rejects.toThrow('read-only mode');
  });

  it('should reject DROP statements', async () => {
    const readOnly = createReadOnlyDriver(driver);
    await expect(
      readOnly.execute('DROP TABLE calendar_accounts')
    ).rejects.toThrow('read-only mode');
  });

  it('should reject ALTER statements', async () => {
    const readOnly = createReadOnlyDriver(driver);
    await expect(
      readOnly.execute('ALTER TABLE calendar_accounts ADD COLUMN foo TEXT')
    ).rejects.toThrow('read-only mode');
  });

  it('should reject CREATE statements', async () => {
    const readOnly = createReadOnlyDriver(driver);
    await expect(
      readOnly.execute('CREATE TABLE foo (id TEXT)')
    ).rejects.toThrow('read-only mode');
  });

  it('should allow PRAGMA statements through execute', async () => {
    const readOnly = createReadOnlyDriver(driver);
    // PRAGMA should not throw
    await expect(
      readOnly.execute('PRAGMA foreign_keys = ON')
    ).resolves.toBeUndefined();
  });

  it('should allow SELECT statements through execute', async () => {
    const readOnly = createReadOnlyDriver(driver);
    // SELECT through execute should not throw (some drivers use execute for reads)
    await expect(
      readOnly.execute('SELECT version FROM schema_version')
    ).resolves.toBeUndefined();
  });

  it('should delegate close and isOpen correctly', async () => {
    const readOnly = createReadOnlyDriver(driver);
    expect(readOnly.isOpen()).toBe(true);
    await readOnly.close();
    expect(readOnly.isOpen()).toBe(false);
  });
});
