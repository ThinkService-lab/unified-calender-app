/**
 * Database migration framework.
 * Detects schema version mismatch on launch, executes forward-only migrations
 * with pre-migration backup, and falls back to read-only mode on failure.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.6
 */

import type { DatabaseDriver } from './database';
import { getSchemaVersion } from './database';
import { SCHEMA_VERSION } from './schema';

// Security Review 2026-05-01: Finding C1 — SQL identifier whitelisting
// Derived from schema.ts to stay in sync with the actual schema.

/** Whitelist of valid table names for backup/restore operations. */
const VALID_TABLE_NAMES: ReadonlySet<string> = new Set([
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
]);

/** Whitelist of valid column names per table for restore operations. */
const VALID_COLUMNS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['calendar_accounts', new Set(['id', 'user_id', 'provider_id', 'display_name', 'email', 'color', 'visibility', 'sync_token', 'last_synced_at', 'status', 'created_at'])],
  ['events', new Set(['id', 'provider_event_id', 'calendar_account_id', 'title', 'description', 'location', 'start_time', 'end_time', 'time_zone', 'is_all_day', 'recurrence_rule', 'recurrence_exception_date', 'parent_recurring_event_id', 'organizer', 'attendees', 'sequence', 'dtstamp', 'status', 'visibility_override', 'opaque_fields', 'sync_status', 'local_version', 'remote_etag', 'modified_by', 'created_at', 'updated_at'])],
  ['sync_queue', new Set(['id', 'calendar_account_id', 'event_id', 'operation', 'payload', 'retry_count', 'max_retries', 'next_retry_at', 'status', 'created_at'])],
  ['user_subscription', new Set(['user_id', 'tier', 'platform', 'receipt_id', 'expires_at', 'grace_period_ends_at', 'auto_renew', 'connected_account_count'])],
  ['privacy_preferences', new Set(['calendar_id', 'visibility'])],
  ['event_visibility_overrides', new Set(['event_id', 'visibility'])],
  ['scheduling_preferences', new Set(['user_id', 'preferred_start_hour', 'preferred_end_hour', 'minimum_buffer_minutes', 'max_meetings_per_day', 'focus_time_blocks', 'learned_patterns'])],
  ['auth_events', new Set(['id', 'user_id', 'event_type', 'platform', 'ip_address', 'user_agent', 'timestamp'])],
  ['onboarding_state', new Set(['user_id', 'current_step', 'completed_steps', 'skipped', 'first_opened_at', 'tooltips_dismissed'])],
  ['shared_views', new Set(['id', 'owner_id', 'name', 'calendar_ids', 'max_members', 'created_at'])],
  ['shared_view_members', new Set(['view_id', 'user_id', 'permission', 'added_at'])],
  ['delegation_grants', new Set(['id', 'delegator_id', 'delegate_id', 'calendar_ids', 'permission', 'granted_at', 'revoked_at'])],
  ['deletion_requests', new Set(['id', 'user_id', 'requested_at', 'scheduled_completion_at', 'status'])],
]);

/**
 * Validate that a table name is in the whitelist.
 * Throws if the name is not recognized.
 */
function validateTableName(table: string): void {
  if (!VALID_TABLE_NAMES.has(table)) {
    throw new Error(`Invalid table name for backup/restore: "${table}"`);
  }
}

/**
 * Filter column names to only those in the whitelist for the given table.
 * Returns only valid columns, silently dropping any unrecognized ones.
 */
function filterValidColumns(table: string, columns: string[]): string[] {
  const validSet = VALID_COLUMNS.get(table);
  if (!validSet) return [];
  return columns.filter((col) => validSet.has(col));
}

/**
 * A single migration step that transforms the schema from one version to the next.
 */
export interface Migration {
  /** The version this migration upgrades TO */
  version: number;
  /** Human-readable description of what this migration does */
  description: string;
  /** SQL statements or logic to execute for this migration */
  up(driver: DatabaseDriver): Promise<void>;
}

/**
 * Result of a migration run.
 */
export interface MigrationResult {
  success: boolean;
  /** The schema version before migration */
  previousVersion: number;
  /** The schema version after migration (or attempted target) */
  currentVersion: number;
  /** Migrations that were applied successfully */
  appliedMigrations: number[];
  /** Error message if migration failed */
  error?: string;
  /** Whether the database is in read-only fallback mode */
  readOnly: boolean;
}

/**
 * Backup data representing the database state before migration.
 */
export interface DatabaseBackup {
  version: number;
  timestamp: string;
  tables: Record<string, Record<string, unknown>[]>;
}

/**
 * Notification callback for migration events.
 */
export type MigrationNotificationHandler = (notification: MigrationNotification) => void;

export interface MigrationNotification {
  type: 'migration_started' | 'migration_complete' | 'migration_failed' | 'read_only_mode';
  message: string;
  details?: {
    fromVersion?: number;
    toVersion?: number;
    error?: string;
  };
}

/**
 * MigrationRunner manages schema migrations for the SQLite database.
 * - Detects version mismatch on launch
 * - Executes forward-only migrations
 * - Creates pre-migration backup
 * - Falls back to read-only mode on failure
 */
export class MigrationRunner {
  private migrations: Migration[] = [];
  private readOnlyMode = false;
  private notificationHandler: MigrationNotificationHandler | null = null;
  private lastBackup: DatabaseBackup | null = null;

  constructor(private driver: DatabaseDriver) {}

  /**
   * Register a migration. Migrations must be registered in order.
   */
  registerMigration(migration: Migration): void {
    this.migrations.push(migration);
    this.migrations.sort((a, b) => a.version - b.version);
  }

  /**
   * Register multiple migrations at once.
   */
  registerMigrations(migrations: Migration[]): void {
    for (const m of migrations) {
      this.registerMigration(m);
    }
  }

  /**
   * Set a notification handler for migration events.
   */
  setNotificationHandler(handler: MigrationNotificationHandler): void {
    this.notificationHandler = handler;
  }

  /**
   * Whether the database is currently in read-only fallback mode.
   */
  isReadOnly(): boolean {
    return this.readOnlyMode;
  }

  /**
   * Get the last backup created before migration.
   */
  getLastBackup(): DatabaseBackup | null {
    return this.lastBackup;
  }

  /**
   * Detect whether a migration is needed by comparing current schema version
   * to the target SCHEMA_VERSION.
   */
  async needsMigration(): Promise<boolean> {
    const currentVersion = await getSchemaVersion(this.driver);
    if (currentVersion === null) return false; // Fresh DB, no migration needed
    return currentVersion < SCHEMA_VERSION;
  }

  /**
   * Get pending migrations that need to be applied.
   */
  async getPendingMigrations(): Promise<Migration[]> {
    const currentVersion = await getSchemaVersion(this.driver);
    if (currentVersion === null) return [];
    return this.migrations.filter((m) => m.version > currentVersion && m.version <= SCHEMA_VERSION);
  }

  /**
   * Run all pending migrations. This is the main entry point.
   * Returns a MigrationResult indicating success/failure and read-only status.
   */
  async run(): Promise<MigrationResult> {
    const currentVersion = await getSchemaVersion(this.driver);

    // Fresh database or already up to date
    if (currentVersion === null || currentVersion >= SCHEMA_VERSION) {
      return {
        success: true,
        previousVersion: currentVersion ?? 0,
        currentVersion: currentVersion ?? 0,
        appliedMigrations: [],
        readOnly: false,
      };
    }

    const pending = await this.getPendingMigrations();
    if (pending.length === 0) {
      return {
        success: true,
        previousVersion: currentVersion,
        currentVersion,
        appliedMigrations: [],
        readOnly: false,
      };
    }

    // Notify migration started
    this.notify({
      type: 'migration_started',
      message: `Migrating database from version ${currentVersion} to ${SCHEMA_VERSION}`,
      details: { fromVersion: currentVersion, toVersion: SCHEMA_VERSION },
    });

    // Create pre-migration backup
    try {
      this.lastBackup = await this.createBackup(currentVersion);
    } catch (backupError) {
      // If backup fails, enter read-only mode
      this.readOnlyMode = true;
      const errorMsg = backupError instanceof Error ? backupError.message : String(backupError);
      this.notify({
        type: 'migration_failed',
        message: `Pre-migration backup failed: ${errorMsg}`,
        details: { fromVersion: currentVersion, toVersion: SCHEMA_VERSION, error: errorMsg },
      });
      this.notify({
        type: 'read_only_mode',
        message: 'Database is now in read-only mode due to backup failure',
      });
      return {
        success: false,
        previousVersion: currentVersion,
        currentVersion,
        appliedMigrations: [],
        error: `Backup failed: ${errorMsg}`,
        readOnly: true,
      };
    }

    // Execute migrations sequentially
    const appliedMigrations: number[] = [];
    let lastAppliedVersion = currentVersion;

    for (const migration of pending) {
      try {
        await migration.up(this.driver);
        // Update schema version after each successful migration
        await this.driver.execute(
          'INSERT INTO schema_version (version, applied_at) VALUES (?, ?)',
          [migration.version, new Date().toISOString()]
        );
        appliedMigrations.push(migration.version);
        lastAppliedVersion = migration.version;
      } catch (migrationError) {
        // Migration failed — enter read-only mode
        this.readOnlyMode = true;
        const errorMsg = migrationError instanceof Error ? migrationError.message : String(migrationError);
        this.notify({
          type: 'migration_failed',
          message: `Migration to version ${migration.version} failed: ${errorMsg}`,
          details: { fromVersion: currentVersion, toVersion: migration.version, error: errorMsg },
        });
        this.notify({
          type: 'read_only_mode',
          message: 'Database is now in read-only mode due to migration failure. Your data is safe but changes cannot be saved.',
        });
        return {
          success: false,
          previousVersion: currentVersion,
          currentVersion: lastAppliedVersion,
          appliedMigrations,
          error: `Migration to v${migration.version} failed: ${errorMsg}`,
          readOnly: true,
        };
      }
    }

    // All migrations succeeded
    this.notify({
      type: 'migration_complete',
      message: `Database migrated successfully from version ${currentVersion} to ${lastAppliedVersion}`,
      details: { fromVersion: currentVersion, toVersion: lastAppliedVersion },
    });

    return {
      success: true,
      previousVersion: currentVersion,
      currentVersion: lastAppliedVersion,
      appliedMigrations,
      readOnly: false,
    };
  }

  /**
   * Create a backup of the current database state.
   * Exports all user data tables as JSON.
   */
  async createBackup(version: number): Promise<DatabaseBackup> {
    const tablesToBackup = [
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

    const tables: Record<string, Record<string, unknown>[]> = {};

    for (const table of tablesToBackup) {
      // Security Review 2026-05-01: Finding C1 — validate table name before use in SQL
      validateTableName(table);
      try {
        const rows = await this.driver.query<Record<string, unknown>>(
          `SELECT * FROM ${table}`
        );
        tables[table] = rows;
      } catch {
        // Table might not exist yet in older schema versions
        tables[table] = [];
      }
    }

    return {
      version,
      timestamp: new Date().toISOString(),
      tables,
    };
  }

  /**
   * Restore database from a backup. Used if migration needs to be reverted.
   * Note: This is a best-effort restore for data recovery, not a rollback mechanism.
   */
  async restoreFromBackup(backup: DatabaseBackup): Promise<void> {
    for (const [table, rows] of Object.entries(backup.tables)) {
      if (rows.length === 0) continue;

      // Security Review 2026-05-01: Finding C1 — validate table and column names
      try {
        validateTableName(table);
      } catch {
        continue; // Skip unrecognized tables from backup
      }

      // Clear existing data
      try {
        await this.driver.execute(`DELETE FROM ${table}`);
      } catch {
        continue; // Table might not exist
      }

      // Re-insert backed up rows with validated column names
      for (const row of rows) {
        const allColumns = Object.keys(row);
        const validColumns = filterValidColumns(table, allColumns);
        if (validColumns.length === 0) continue;

        const placeholders = validColumns.map(() => '?').join(', ');
        const values = validColumns.map((col) => row[col]);
        try {
          await this.driver.execute(
            `INSERT INTO ${table} (${validColumns.join(', ')}) VALUES (${placeholders})`,
            values
          );
        } catch {
          // Skip rows that can't be restored (schema mismatch)
        }
      }
    }
  }

  private notify(notification: MigrationNotification): void {
    if (this.notificationHandler) {
      this.notificationHandler(notification);
    }
  }
}

/**
 * Creates a ReadOnlyDatabaseDriver that wraps an existing driver
 * and rejects all write operations. Used as fallback when migration fails.
 */
export function createReadOnlyDriver(driver: DatabaseDriver): DatabaseDriver {
  const readOnly: DatabaseDriver = {
    async execute(sql: string, params?: unknown[]): Promise<void> {
      const normalized = sql.trim().toUpperCase();
      if (
        normalized.startsWith('INSERT') ||
        normalized.startsWith('UPDATE') ||
        normalized.startsWith('DELETE') ||
        normalized.startsWith('DROP') ||
        normalized.startsWith('ALTER') ||
        normalized.startsWith('CREATE')
      ) {
        throw new Error(
          'Database is in read-only mode due to a migration failure. Please update the app to resolve this issue.'
        );
      }
      // Allow PRAGMA and SELECT through execute
      return driver.execute(sql, params);
    },
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      return driver.query<T>(sql, params);
    },
    async close(): Promise<void> {
      return driver.close();
    },
    isOpen(): boolean {
      return driver.isOpen();
    },
    supportsTransactions: false,
    async transaction<T>(): Promise<T> {
      throw new Error(
        'Database is in read-only mode due to a migration failure. Transactions are not available.'
      );
    },
  };
  return readOnly;
}
