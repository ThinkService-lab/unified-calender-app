/**
 * Tests for SQLite storage adapter.
 */

import { createSQLiteStorage, ensureKVTable } from '../sqliteStorageAdapter';
import type { DatabaseDriver } from '../../db/database';

function createMockDriver(): DatabaseDriver & { data: Record<string, string> } {
  const data: Record<string, string> = {};

  const mockQuery = jest.fn(async (_sql: string, params?: unknown[]) => {
    const [key] = params as [string];
    if (data[key] !== undefined) {
      return [{ value: data[key] }];
    }
    return [];
  });

  return {
    data,
    execute: jest.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT OR REPLACE')) {
        const [key, value] = params as [string, string];
        data[key] = value;
      } else if (sql.includes('DELETE')) {
        const [key] = params as [string];
        delete data[key];
      }
    }),
    query: mockQuery as DatabaseDriver['query'],
    close: jest.fn(async () => {}),
    isOpen: jest.fn(() => true),
  };
}

describe('SQLiteStorageAdapter', () => {
  let driver: ReturnType<typeof createMockDriver>;

  beforeEach(() => {
    driver = createMockDriver();
  });

  test('ensureKVTable creates the table', async () => {
    await ensureKVTable(driver);
    expect(driver.execute).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS')
    );
  });

  test('setItem stores a value', async () => {
    const storage = createSQLiteStorage(driver);
    await storage.setItem('test-key', '{"value": 1}');
    expect(driver.data['test-key']).toBe('{"value": 1}');
  });

  test('getItem retrieves a stored value', async () => {
    const storage = createSQLiteStorage(driver);
    await storage.setItem('key1', 'hello');
    const result = await storage.getItem('key1');
    expect(result).toBe('hello');
  });

  test('getItem returns null for missing key', async () => {
    const storage = createSQLiteStorage(driver);
    const result = await storage.getItem('nonexistent');
    expect(result).toBeNull();
  });

  test('removeItem deletes a value', async () => {
    const storage = createSQLiteStorage(driver);
    await storage.setItem('key1', 'value1');
    await storage.removeItem('key1');
    const result = await storage.getItem('key1');
    expect(result).toBeNull();
  });

  test('setItem overwrites existing value', async () => {
    const storage = createSQLiteStorage(driver);
    await storage.setItem('key1', 'first');
    await storage.setItem('key1', 'second');
    const result = await storage.getItem('key1');
    expect(result).toBe('second');
  });
});
