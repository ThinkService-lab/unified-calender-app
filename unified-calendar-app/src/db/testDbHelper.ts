/**
 * Shared test helper for creating mock DatabaseDriver instances.
 * Provides default implementations for `transaction` and `supportsTransactions`
 * so test mocks don't need to implement them individually.
 */

import type { DatabaseDriver, TransactionContext } from '../database';

/**
 * Adds default `transaction` and `supportsTransactions` to a partial
 * DatabaseDriver mock. The default transaction implementation simply
 * delegates to the mock's execute/query without BEGIN/COMMIT wrapping.
 */
export function withTransactionSupport(
  partial: Omit<DatabaseDriver, 'transaction' | 'supportsTransactions'>,
): DatabaseDriver {
  return {
    ...partial,
    supportsTransactions: true,
    async transaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
      const tx: TransactionContext = {
        execute: (sql, params) => partial.execute(sql, params),
        query: <R = Record<string, unknown>>(sql: string, params?: unknown[]) =>
          partial.query<R>(sql, params),
      };
      return fn(tx);
    },
  };
}
