/**
 * Error display module re-exports.
 * Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6
 */

// Types
export type {
  ErrorCategory,
  ErrorResolutionStatus,
  ErrorDisplayEntry,
  ErrorActionType,
  ErrorLogEntry,
  RawErrorContext,
} from './types';
export { MAX_ERROR_LOG_ENTRIES } from './types';

// Error store
export {
  useErrorStore,
  createErrorStore,
  useActiveErrors,
  useIsOffline,
  useErrorLog,
  useErrorSummary,
} from './errorStore';
export type { ErrorState } from './errorStore';

// Error display service
export {
  createErrorDisplayService,
  computeGracePeriodDays,
  generateErrorId,
  resetErrorIdCounter,
} from './errorDisplayService';
export type {
  ErrorDisplayService,
  ErrorDisplayServiceDeps,
} from './errorDisplayService';
