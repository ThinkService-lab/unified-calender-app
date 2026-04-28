/**
 * Sync engine type definitions.
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 6.3
 */

import type { ChangeSet } from '../providers/types';

/** Sync engine states */
export type SyncState =
  | 'Idle'
  | 'SyncingOutbound'
  | 'SyncingInbound'
  | 'FullSync'
  | 'ConflictResolution'
  | 'RetryQueue';

/** A local change to be synced outbound */
export interface LocalChange {
  calendarAccountId: string;
  eventId: string;
  operation: 'create' | 'update' | 'delete';
  payload: string;
}

/** Result of a sync operation */
export interface SyncResult {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  conflicts: SyncConflict[];
}

/** A sync conflict between local and remote versions */
export interface SyncConflict {
  id: string;
  eventId: string;
  calendarAccountId: string;
  localVersion: string;
  remoteVersion: string;
  detectedAt: Date;
}

/** Resolution strategy for a sync conflict */
export type ConflictResolution = 'keep_local' | 'keep_remote';

/** Webhook notification payload from a provider */
export interface WebhookPayload {
  accountId: string;
  calendarId?: string;
  changeType: 'created' | 'updated' | 'deleted' | 'sync';
  resourceId?: string;
  syncToken?: string;
}

/** Callback for user notification on sync events */
export type SyncNotificationCallback = (message: string, severity: 'info' | 'warning' | 'error') => void;

/** SyncEngine interface as defined in the design doc */
export interface SyncEngine {
  start(): void;
  stop(): void;
  queueLocalChange(change: LocalChange): void;
  processOutboundQueue(): Promise<SyncResult>;
  handleWebhookNotification(notification: WebhookPayload): Promise<void>;
  pollProvider(accountId: string): Promise<ChangeSet>;
  readonly pollingIntervalMs: number;
  getConflicts(): SyncConflict[];
  resolveConflict(conflictId: string, resolution: ConflictResolution): Promise<void>;
  fullSync(accountId: string): Promise<SyncResult>;
  syncAllPending(): Promise<SyncResult>;
  readonly state: SyncState;
}
