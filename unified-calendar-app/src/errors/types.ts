/**
 * Error display types for the Unified Calendar App.
 * Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6
 *
 * These types define the error categories, display entries, and error log
 * entries used by the ErrorDisplayService and error store.
 */

/** Error categories matching the design's error handling strategy */
export type ErrorCategory =
  | 'sync'
  | 'auth'
  | 'payment'
  | 'offline'
  | 'provider'
  | 'storage'
  | 'parse'
  | 'conflict';

/** Resolution status for error log entries */
export type ErrorResolutionStatus = 'unresolved' | 'resolved' | 'dismissed';

/**
 * An active error displayed to the user.
 * Never contains raw error codes, stack traces, or technical jargon (Req 19.6).
 */
export interface ErrorDisplayEntry {
  /** Unique identifier for this error display */
  id: string;
  /** Error category determines the display style */
  category: ErrorCategory;
  /** User-friendly summary (e.g., "Unable to sync your Google Calendar") */
  userMessage: string;
  /** Optional longer description shown when user taps "Details" */
  detailMessage: string | null;
  /** The action label shown on the banner/badge (e.g., "Details", "Reconnect", "Update Payment") */
  actionLabel: string;
  /** Action type to invoke when the user taps the action */
  actionType: ErrorActionType;
  /** Whether the banner is persistent (cannot be auto-dismissed) */
  persistent: boolean;
  /** Associated calendar account ID, if applicable */
  accountId: string | null;
  /** Grace period end date for payment errors */
  gracePeriodEndsAt: Date | null;
  /** Timestamp when this error was created */
  createdAt: Date;
}

/** Action types that can be triggered from error displays */
export type ErrorActionType =
  | 'show_details'
  | 'reconnect_account'
  | 'update_payment'
  | 'dismiss'
  | 'none';

/**
 * An entry in the error log accessible from Settings.
 * Stores the last 50 errors with timestamps and resolution status (Req 19.5).
 */
export interface ErrorLogEntry {
  id: string;
  category: ErrorCategory;
  userMessage: string;
  detailMessage: string | null;
  timestamp: Date;
  resolutionStatus: ErrorResolutionStatus;
  resolvedAt: Date | null;
}

/** Maximum number of error log entries to retain */
export const MAX_ERROR_LOG_ENTRIES = 50;

/**
 * Maps raw/technical error information to a user-friendly ErrorDisplayEntry.
 * This is the input to the ErrorDisplayService — callers provide the raw context,
 * and the service produces a sanitized, user-friendly display.
 */
export interface RawErrorContext {
  /** The error category */
  category: ErrorCategory;
  /** The original error (for internal logging only — never shown to user) */
  originalError?: unknown;
  /** Associated calendar account ID */
  accountId?: string;
  /** Associated calendar account display name */
  accountName?: string;
  /** Provider name (e.g., "Google Calendar") */
  providerName?: string;
  /** Grace period end date (for payment errors) */
  gracePeriodEndsAt?: Date;
}
