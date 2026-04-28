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
  /** Close the database connection */
  close(): Promise<void>;
  /** Whether the database connection is open */
  isOpen(): boolean;
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
  ];

  const rows = await driver.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  );
  const tableNames = rows.map((r) => r.name);

  return expectedTables.every((t) => tableNames.includes(t));
}
