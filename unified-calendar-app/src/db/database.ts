/**
 * Database initialization and management.
 * Provides a unified interface for SQLite operations across platforms.
 * Requirements: 6.1, 6.4, 6.6, 13.2, 17.1
 */

import { getSchemaSQL, SCHEMA_VERSION } from './schema';

/**
 * Platform-agnostic database driver interface.
 * Each platform (iOS, Android, Web) provides its own implementation.
 */
export interface DatabaseDriver {
  /** Execute a SQL statement that doesn't return rows */
  execute(sql: string, params?: unknown[]): Promise<void>;
  /** Execute a SQL query that returns rows */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /**
   * Execute a set of operations within a single SQLite transaction.
   *
   * All statements executed via the callback's `execute`/`query` methods
   * are wrapped in BEGIN/COMMIT. If the callback throws, the transaction
   * is rolled back automatically.
   *
   * Platform drivers that do not yet support transactions may fall back
   * to executing statements sequentially (no atomicity guarantee). The
   * `supportsTransactions` flag indicates whether true transaction
   * support is available.
   */
  transaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
  /** Whether the driver supports true atomic transactions */
  readonly supportsTransactions: boolean;
  /** Close the database connection */
  close(): Promise<void>;
  /** Whether the database connection is open */
  isOpen(): boolean;
}

/**
 * Context passed to the `transaction` callback.
 * Provides the same execute/query interface scoped to the active transaction.
 */
export interface TransactionContext {
  execute(sql: string, params?: unknown[]): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

/**
 * Database configuration options.
 */
export interface DatabaseConfig {
  /** Database file name */
  name: string;
  /** Optional encryption key (for AES-256-GCM at-rest encryption) */
  encryptionKey?: string;
}

/**
 * Initializes the database schema.
 * Creates all tables, indexes, and sets the schema version.
 * Enables foreign key enforcement (required for CASCADE deletes).
 */
export async function initializeSchema(driver: DatabaseDriver): Promise<void> {
  // Enable foreign keys (required for CASCADE constraints)
  await driver.execute('PRAGMA foreign_keys = ON');

  // Check current schema version
  const currentVersion = await getSchemaVersion(driver);

  if (currentVersion === null) {
    // Fresh database — create all tables and indexes
    const statements = getSchemaSQL();
    for (const sql of statements) {
      await driver.execute(sql);
    }

    // Record schema version
    await driver.execute(
      'INSERT INTO schema_version (version, applied_at) VALUES (?, ?)',
      [SCHEMA_VERSION, new Date().toISOString()]
    );
  }
  // If currentVersion < SCHEMA_VERSION, migrations would be handled by the migration framework (Task 1.4)
}

/**
 * Gets the current schema version from the database.
 * Returns null if the schema_version table doesn't exist (fresh database).
 */
export async function getSchemaVersion(driver: DatabaseDriver): Promise<number | null> {
  try {
    const rows = await driver.query<{ version: number }>(
      'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1'
    );
    if (rows.length === 0) return null;
    return rows[0].version;
  } catch {
    // Table doesn't exist yet
    return null;
  }
}

/**
 * Verifies that all expected tables exist in the database.
 */
export async function verifySchema(driver: DatabaseDriver): Promise<boolean> {
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
    'shared_views',
    'shared_view_members',
    'delegation_grants',
    'deletion_requests',
  ];

  const rows = await driver.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  );
  const tableNames = rows.map((r) => r.name);

  return expectedTables.every((t) => tableNames.includes(t));
}

/**
 * Creates a default `transaction` implementation for drivers that support
 * manual BEGIN/COMMIT/ROLLBACK. Platform drivers can use this helper or
 * provide their own native transaction support.
 *
 * Wraps the callback in BEGIN TRANSACTION / COMMIT, rolling back on error.
 */
export async function executeTransaction<T>(
  driver: Pick<DatabaseDriver, 'execute' | 'query'>,
  fn: (tx: TransactionContext) => Promise<T>,
): Promise<T> {
  const tx: TransactionContext = {
    execute: (sql, params) => driver.execute(sql, params),
    query: <R = Record<string, unknown>>(sql: string, params?: unknown[]) =>
      driver.query<R>(sql, params),
  };

  await driver.execute('BEGIN TRANSACTION');
  try {
    const result = await fn(tx);
    await driver.execute('COMMIT');
    return result;
  } catch (error) {
    await driver.execute('ROLLBACK');
    throw error;
  }
}
