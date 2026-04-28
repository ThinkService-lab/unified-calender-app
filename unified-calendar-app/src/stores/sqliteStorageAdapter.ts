/**
 * Custom Zustand persist storage adapter backed by SQLite.
 * Uses the DatabaseDriver interface for platform-agnostic storage.
 * Requirements: 6.1
 */

import type { StateStorage } from 'zustand/middleware';
import type { DatabaseDriver } from '../db/database';

const KV_TABLE = 'zustand_kv_store';

/**
 * Ensures the key-value table exists in the database.
 */
export async function ensureKVTable(driver: DatabaseDriver): Promise<void> {
  await driver.execute(
    `CREATE TABLE IF NOT EXISTS ${KV_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
  );
}

/**
 * Creates a Zustand-compatible StateStorage backed by SQLite.
 * The adapter stores serialized JSON state in a simple key-value table.
 */
export function createSQLiteStorage(driver: DatabaseDriver): StateStorage {
  return {
    getItem: async (name: string): Promise<string | null> => {
      const rows = await driver.query<{ value: string }>(
        `SELECT value FROM ${KV_TABLE} WHERE key = ?`,
        [name]
      );
      return rows.length > 0 ? rows[0].value : null;
    },

    setItem: async (name: string, value: string): Promise<void> => {
      await driver.execute(
        `INSERT OR REPLACE INTO ${KV_TABLE} (key, value) VALUES (?, ?)`,
        [name, value]
      );
    },

    removeItem: async (name: string): Promise<void> => {
      await driver.execute(
        `DELETE FROM ${KV_TABLE} WHERE key = ?`,
        [name]
      );
    },
  };
}
