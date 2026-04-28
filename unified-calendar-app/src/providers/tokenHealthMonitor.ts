/**
 * TokenHealthMonitor — proactive token validity checking.
 * Monitors token health on 30-second intervals and fires callbacks
 * when tokens transition to revoked or expired states.
 * Requirements: 1.4
 */

import type { CalendarAccount } from '../types/models';
import type { TokenHealthStatus } from '../types/auth';

/** Function that performs a lightweight API call to check token validity */
export type TokenHealthChecker = (accountId: string) => Promise<TokenHealthStatus>;

export interface TokenHealthMonitorConfig {
  /** Function to check token health for a given account */
  checkHealth: TokenHealthChecker;
  /** Interval in milliseconds between health checks (default: 30000) */
  intervalMs?: number;
}

/**
 * Monitors token validity with lightweight API calls on configurable intervals.
 * Fires `onTokenRevoked` callback when a token transitions to 'revoked' or 'expired'.
 */
export class TokenHealthMonitor {
  private readonly checkHealth: TokenHealthChecker;
  private readonly intervalMs: number;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private monitoredAccounts: CalendarAccount[] = [];
  private previousStatuses: Map<string, TokenHealthStatus> = new Map();
  private _lastCheckPromise: Promise<void> | null = null;

  /** Callback fired when a token transitions to revoked or expired */
  onTokenRevoked: (accountId: string) => void = () => {};

  constructor(config: TokenHealthMonitorConfig) {
    this.checkHealth = config.checkHealth;
    this.intervalMs = config.intervalMs ?? 30_000;
  }

  /**
   * Start monitoring the given accounts on the configured interval.
   * Replaces any previously monitored account list.
   */
  startMonitoring(accounts: CalendarAccount[]): void {
    this.stopMonitoring();
    this.monitoredAccounts = [...accounts];

    // Run an initial check immediately
    this._lastCheckPromise = this.runHealthChecks();

    this.intervalId = setInterval(() => {
      this._lastCheckPromise = this.runHealthChecks();
    }, this.intervalMs);
  }

  /** Stop monitoring and clear all state. */
  stopMonitoring(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.monitoredAccounts = [];
    this.previousStatuses.clear();
    this._lastCheckPromise = null;
  }

  /**
   * Check token health for a single account.
   * Returns the current health status.
   */
  async checkTokenHealth(accountId: string): Promise<TokenHealthStatus> {
    try {
      return await this.checkHealth(accountId);
    } catch {
      return 'unknown';
    }
  }

  /**
   * Wait for the most recent health check cycle to complete.
   * Useful for testing.
   */
  async waitForCheck(): Promise<void> {
    if (this._lastCheckPromise) {
      await this._lastCheckPromise;
    }
  }

  /** Run health checks for all monitored accounts. */
  private async runHealthChecks(): Promise<void> {
    const checks = this.monitoredAccounts.map(async (account) => {
      const status = await this.checkTokenHealth(account.id);
      const previous = this.previousStatuses.get(account.id);

      // Fire callback only on transition to revoked or expired
      if (
        (status === 'revoked' || status === 'expired') &&
        previous !== status
      ) {
        this.onTokenRevoked(account.id);
      }

      this.previousStatuses.set(account.id, status);
    });

    await Promise.all(checks);
  }
}
