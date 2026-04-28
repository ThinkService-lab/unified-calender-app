/**
 * Android-specific SQLite driver using op-sqlite.
 * Requirements: 6.1, 13.2
 */

import { open, type DB } from '@op-engineering/op-sqlite';
import type { DatabaseDriver, DatabaseConfig } from './database';

/**
 * Creates an Android SQLite database driver backed by op-sqlite.
 * Supports optional AES-256 encryption via op-sqlite's built-in encryption.
 */
export function createDatabaseDriver(config: DatabaseConfig): DatabaseDriver {
  const db: DB = open({
    name: config.name,
    encryptionKey: config.encryptionKey,
  });

  let isDbOpen = true;

  return {
    async execute(sql: string, params?: unknown[]): Promise<void> {
      db.execute(sql, params as any[]);
    },

    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      const result = db.execute(sql, params as any[]);
      // op-sqlite v15+ returns { rows: Array } directly
      return (result.rows ?? []) as T[];
    },

    async close(): Promise<void> {
      db.close();
      isDbOpen = false;
    },

    isOpen(): boolean {
      return isDbOpen;
    },
  };
}
