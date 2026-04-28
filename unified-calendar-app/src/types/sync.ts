/**
 * Sync engine type definitions.
 * Requirements: 3.1, 5.1
 */

export interface SyncQueueEntry {
  id: string;
  calendarAccountId: string;
  eventId: string;
  operation: 'create' | 'update' | 'delete';
  payload: string;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: Date;
  status: 'pending' | 'in_progress' | 'failed' | 'completed';
  createdAt: Date;
}

export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterFactor: number;
}
