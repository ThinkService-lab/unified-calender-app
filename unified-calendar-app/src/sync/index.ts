/**
 * Sync engine module public API.
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 6.3
 */

export { createSyncEngine } from './syncEngine';
export type { SyncEngineConfig } from './syncEngine';

export { createConflictResolver } from './conflictResolver';
export type {
  SyncConflictResolver,
  TrackedConflict,
  ConflictState,
  ConflictDetails,
  ConflictEventVersion,
  ConflictResolverConfig,
} from './conflictResolver';

export type {
  SyncState,
  LocalChange,
  SyncResult,
  SyncConflict,
  ConflictResolution,
  WebhookPayload,
  SyncEngine,
  SyncNotificationCallback,
} from './types';

export {
  createRateLimitManager,
  RateLimitExceededError,
  RateLimitDeferredError,
} from './rateLimitManager';
export type {
  RateLimitManager,
  RateLimitManagerConfig,
  OperationPriority,
  ProviderHealthStatus,
  ProviderRateLimitConfig,
  BackoffConfig,
  RateLimitLogEntry,
  AccountHealthSnapshot,
  RateLimitAcquireResult,
} from './rateLimitManager';
