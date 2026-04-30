/**
 * ErrorDisplayService — translates raw errors into user-friendly displays.
 *
 * This service is the single entry point for surfacing errors to the user.
 * It ensures that:
 * - Sync errors show a non-intrusive banner with "Details" action (Req 19.1)
 * - Auth errors show a badge on the affected account with "Reconnect" (Req 19.2)
 * - Payment errors show a persistent banner with grace period countdown (Req 19.3)
 * - Offline state shows an indicator confirming changes will sync (Req 19.4)
 * - All errors are logged (last 50) with timestamps and resolution status (Req 19.5)
 * - No raw error codes, stack traces, or technical jargon are shown (Req 19.6)
 */

import type {
  ErrorDisplayEntry,
  ErrorCategory,
  ErrorActionType,
  RawErrorContext,
} from './types';

/** Dependencies injected into the service */
export interface ErrorDisplayServiceDeps {
  /** Adds an error display entry to the store */
  addError: (entry: ErrorDisplayEntry) => void;
  /** Dismisses an error by ID */
  dismissError: (errorId: string) => void;
  /** Dismisses all errors for a category */
  dismissErrorsByCategory: (category: ErrorCategory) => void;
  /** Dismisses all errors for an account */
  dismissErrorsByAccount: (accountId: string) => void;
  /** Sets the offline state */
  setOffline: (offline: boolean) => void;
  /** Resolves an error (marks as resolved in log) */
  resolveError: (errorId: string) => void;
}

export interface ErrorDisplayService {
  /** Report a sync error — shows non-intrusive banner with "Details" action */
  showSyncError: (context: RawErrorContext) => string;
  /** Report an auth error — shows badge on affected account with "Reconnect" */
  showAuthError: (context: RawErrorContext) => string;
  /** Report a payment error — shows persistent banner with grace period countdown */
  showPaymentError: (context: RawErrorContext) => string;
  /** Set offline/online state — shows/hides offline indicator */
  setOfflineStatus: (offline: boolean) => string | null;
  /** Report a generic error (provider, storage, parse, conflict) */
  showError: (context: RawErrorContext) => string;
  /** Dismiss an active error */
  dismiss: (errorId: string) => void;
  /** Resolve an error (e.g., after successful reconnect) */
  resolve: (errorId: string) => void;
  /** Dismiss all errors for a specific account */
  clearAccountErrors: (accountId: string) => void;
}

let idCounter = 0;

/** Generates a unique error ID */
export function generateErrorId(): string {
  idCounter += 1;
  return `err-${Date.now()}-${idCounter}`;
}

/** Reset the ID counter (for testing) */
export function resetErrorIdCounter(): void {
  idCounter = 0;
}

/**
 * Creates an ErrorDisplayService instance.
 */
export function createErrorDisplayService(
  deps: ErrorDisplayServiceDeps
): ErrorDisplayService {
  function buildEntry(
    context: RawErrorContext,
    overrides: {
      userMessage: string;
      detailMessage: string | null;
      actionLabel: string;
      actionType: ErrorActionType;
      persistent: boolean;
    }
  ): ErrorDisplayEntry {
    return {
      id: generateErrorId(),
      category: context.category,
      userMessage: overrides.userMessage,
      detailMessage: overrides.detailMessage,
      actionLabel: overrides.actionLabel,
      actionType: overrides.actionType,
      persistent: overrides.persistent,
      accountId: context.accountId ?? null,
      gracePeriodEndsAt: context.gracePeriodEndsAt ?? null,
      createdAt: new Date(),
    };
  }

  /**
   * Builds a user-friendly message for sync errors.
   * Never exposes raw error codes or stack traces (Req 19.6).
   */
  function buildSyncMessage(context: RawErrorContext): {
    userMessage: string;
    detailMessage: string;
  } {
    const target = context.providerName ?? context.accountName ?? 'your calendar';
    return {
      userMessage: `Unable to sync ${target}`,
      detailMessage: `We couldn't sync your latest changes with ${target}. This may be due to a temporary issue. Your changes are saved locally and will sync automatically when the issue is resolved.`,
    };
  }

  /**
   * Builds a user-friendly message for auth errors.
   */
  function buildAuthMessage(context: RawErrorContext): {
    userMessage: string;
    detailMessage: string;
  } {
    const target = context.providerName ?? context.accountName ?? 'your calendar';
    return {
      userMessage: `${target} needs to be reconnected`,
      detailMessage: `Your connection to ${target} has expired or was revoked. Please reconnect to continue syncing.`,
    };
  }

  /**
   * Builds a user-friendly message for payment errors.
   */
  function buildPaymentMessage(context: RawErrorContext): {
    userMessage: string;
    detailMessage: string;
  } {
    const daysRemaining = computeGracePeriodDays(context.gracePeriodEndsAt);
    const daysText =
      daysRemaining !== null
        ? `You have ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining before your plan features are restricted.`
        : 'Your plan features may be restricted soon.';
    return {
      userMessage: `Payment issue — ${daysText}`,
      detailMessage: `There was a problem processing your subscription payment. Please update your payment method to continue using all features. ${daysText}`,
    };
  }

  /**
   * Builds a user-friendly message for generic errors.
   */
  function buildGenericMessage(context: RawErrorContext): {
    userMessage: string;
    detailMessage: string;
  } {
    const categoryMessages: Record<
      string,
      { userMessage: string; detailMessage: string }
    > = {
      provider: {
        userMessage: 'Calendar service temporarily unavailable',
        detailMessage:
          'The calendar service is experiencing issues. Your data is safe and we will retry automatically.',
      },
      storage: {
        userMessage: 'Unable to save changes locally',
        detailMessage:
          'There was a problem saving your changes to the device. Please try again or restart the app.',
      },
      parse: {
        userMessage: 'Unable to read calendar data',
        detailMessage:
          'Some calendar data could not be read. The affected events may not display correctly.',
      },
      conflict: {
        userMessage: 'Schedule conflict detected',
        detailMessage:
          'A scheduling conflict was found. Please review the conflicting events.',
      },
    };

    return (
      categoryMessages[context.category] ?? {
        userMessage: 'Something went wrong',
        detailMessage:
          'An unexpected issue occurred. Please try again or contact support if the problem persists.',
      }
    );
  }

  return {
    showSyncError(context: RawErrorContext): string {
      const ctx = { ...context, category: 'sync' as ErrorCategory };
      const { userMessage, detailMessage } = buildSyncMessage(ctx);
      const entry = buildEntry(ctx, {
        userMessage,
        detailMessage,
        actionLabel: 'Details',
        actionType: 'show_details',
        persistent: false,
      });
      deps.addError(entry);
      return entry.id;
    },

    showAuthError(context: RawErrorContext): string {
      const ctx = { ...context, category: 'auth' as ErrorCategory };
      const { userMessage, detailMessage } = buildAuthMessage(ctx);
      const entry = buildEntry(ctx, {
        userMessage,
        detailMessage,
        actionLabel: 'Reconnect',
        actionType: 'reconnect_account',
        persistent: true,
      });
      deps.addError(entry);
      return entry.id;
    },

    showPaymentError(context: RawErrorContext): string {
      const ctx = { ...context, category: 'payment' as ErrorCategory };
      const { userMessage, detailMessage } = buildPaymentMessage(ctx);
      const entry = buildEntry(ctx, {
        userMessage,
        detailMessage,
        actionLabel: 'Update Payment',
        actionType: 'update_payment',
        persistent: true,
      });
      deps.addError(entry);
      return entry.id;
    },

    setOfflineStatus(offline: boolean): string | null {
      deps.setOffline(offline);
      if (offline) {
        const entry = buildEntry(
          { category: 'offline' },
          {
            userMessage: "You're offline",
            detailMessage:
              'Your changes are saved locally and will sync automatically when you reconnect.',
            actionLabel: '',
            actionType: 'none',
            persistent: true,
          }
        );
        deps.addError(entry);
        return entry.id;
      } else {
        // Going online — dismiss offline errors
        deps.dismissErrorsByCategory('offline');
        return null;
      }
    },

    showError(context: RawErrorContext): string {
      // Route to specific handlers for known categories
      if (context.category === 'sync') return this.showSyncError(context);
      if (context.category === 'auth') return this.showAuthError(context);
      if (context.category === 'payment') return this.showPaymentError(context);

      const { userMessage, detailMessage } = buildGenericMessage(context);
      const entry = buildEntry(context, {
        userMessage,
        detailMessage,
        actionLabel: 'Details',
        actionType: 'show_details',
        persistent: false,
      });
      deps.addError(entry);
      return entry.id;
    },

    dismiss(errorId: string): void {
      deps.dismissError(errorId);
    },

    resolve(errorId: string): void {
      deps.resolveError(errorId);
    },

    clearAccountErrors(accountId: string): void {
      deps.dismissErrorsByAccount(accountId);
    },
  };
}

/**
 * Computes the number of whole days remaining in a grace period.
 * Returns null if no grace period end date is provided.
 */
export function computeGracePeriodDays(
  gracePeriodEndsAt: Date | null | undefined
): number | null {
  if (!gracePeriodEndsAt) return null;
  const now = new Date();
  const diffMs = gracePeriodEndsAt.getTime() - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}
