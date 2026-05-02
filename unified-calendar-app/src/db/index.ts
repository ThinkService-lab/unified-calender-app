/**
 * Database module public API.
 * Requirements: 6.1, 6.4, 6.6, 13.2, 17.1, 17.2, 17.3, 17.4, 17.6
 */

export { SCHEMA_VERSION, CREATE_TABLES_SQL, CREATE_INDEXES_SQL, getSchemaSQL } from './schema';
export { initializeSchema, getSchemaVersion, verifySchema, executeTransaction } from './database';
export type { DatabaseDriver, DatabaseConfig, TransactionContext } from './database';
export { encrypt, decrypt, deriveEncryptionKey, AES_CONFIG } from './encryption';
export type { EncryptedData } from './encryption';
export { MigrationRunner, createReadOnlyDriver } from './migration';
export type {
  Migration,
  MigrationResult,
  DatabaseBackup,
  MigrationNotification,
  MigrationNotificationHandler,
} from './migration';
