/**
 * Web-specific SQLite driver using sql.js (WebAssembly SQLite).
 * Requirements: 6.1, 13.2
 */

import initSqlJs, { type Database } from 'sql.js';
import type { DatabaseDriver, DatabaseConfig, TransactionContext } from './database';
import { executeTransaction } from './database';

/**
 * Creates a Web SQLite database driver backed by sql.js.
 * Note: sql.js runs SQLite in WebAssembly. Encryption at rest is handled
 * by the encryption wrapper module since sql.js doesn't support native encryption.
 */
export async function createDatabaseDriver(_config: DatabaseConfig): Promise<DatabaseDriver> {
  const SQL = await initSqlJs();
  const db: Database = new SQL.Database();

  let isDbOpen = true;

  const driver: DatabaseDriver = {
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
        const row = stmt.getAsObject();
        results.push(row as T);
      }
      stmt.free();
      return results;
    },

    supportsTransactions: true,

    // Security Review 2026-05-02: Finding H8 — implement transaction support
    // via the shared executeTransaction helper (BEGIN / COMMIT / ROLLBACK).
    async transaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
      return executeTransaction(driver, fn);
    },

    async close(): Promise<void> {
      db.close();
      isDbOpen = false;
    },

    isOpen(): boolean {
      return isDbOpen;
    },
  };

  return driver;
}
