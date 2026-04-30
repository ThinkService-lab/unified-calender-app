/**
 * OnboardingManager — guided onboarding flow and contextual tooltips.
 *
 * - 4-step flow: welcome → connect_first_account → choose_view → explore_features
 * - Tracks progress in SQLite (onboarding_state table)
 * - Supports skip with re-access from settings
 * - Contextual tooltips for first 7 days
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */

import type { DatabaseDriver } from '../db/database';
import type { OnboardingState, OnboardingStep } from '../types/onboarding';

/** Ordered steps in the onboarding flow (max 4, Req 11.1) */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  'welcome',
  'connect_first_account',
  'choose_view',
  'explore_features',
] as const;

/** Duration in milliseconds for contextual tooltip display (7 days, Req 11.4) */
export const TOOLTIP_DISPLAY_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

export interface OnboardingManager {
  /** Get the current onboarding state for a user. Creates initial state if none exists. */
  getOnboardingState(userId: string): Promise<OnboardingState>;
  /** Complete the current step and advance to the next. */
  completeStep(userId: string, step: OnboardingStep): Promise<void>;
  /** Skip the onboarding flow entirely (Req 11.5). */
  skipOnboarding(userId: string): Promise<void>;
  /** Reset onboarding to the beginning, accessible from settings (Req 11.5). */
  resetOnboarding(userId: string): Promise<void>;
  /** Whether the onboarding flow is complete (all steps done or skipped). */
  isComplete(userId: string): Promise<boolean>;
  /** Whether a contextual tooltip should be shown for a feature (Req 11.4). */
  shouldShowTooltip(userId: string, feature: string): Promise<boolean>;
  /** Dismiss a contextual tooltip for a feature. */
  dismissTooltip(userId: string, feature: string): Promise<void>;
}

export interface OnboardingManagerConfig {
  db: DatabaseDriver;
  /** Optional clock function for testability. Defaults to Date.now. */
  now?: () => number;
  /**
   * Callback fired when onboarding completes (last step finished or flow skipped).
   * The UI should use this to transition to the Unified View with all calendars visible (Req 11.3).
   */
  onComplete?: (userId: string) => void;
}

/**
 * Determine the next step after a given step.
 * Returns null if the given step is the last one.
 */
function getNextStep(step: OnboardingStep): OnboardingStep | null {
  const index = ONBOARDING_STEPS.indexOf(step);
  if (index < 0 || index >= ONBOARDING_STEPS.length - 1) {
    return null;
  }
  return ONBOARDING_STEPS[index + 1];
}

/**
 * Creates an OnboardingManager instance.
 */
export function createOnboardingManager(
  config: OnboardingManagerConfig,
): OnboardingManager {
  const { db } = config;
  const now = config.now ?? Date.now;
  const onComplete = config.onComplete;

  /**
   * Load onboarding state from the database.
   * Returns null if no state exists for the user.
   */
  async function loadState(userId: string): Promise<OnboardingState | null> {
    const rows = await db.query<{
      user_id: string;
      current_step: string;
      completed_steps: string;
      skipped: number;
      first_opened_at: number;
      tooltips_dismissed: string;
    }>(
      'SELECT * FROM onboarding_state WHERE user_id = ?',
      [userId],
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    let completedSteps: OnboardingStep[] = [];
    let tooltipsDismissed: string[] = [];

    try {
      completedSteps = JSON.parse(row.completed_steps);
    } catch {
      completedSteps = [];
    }

    try {
      tooltipsDismissed = JSON.parse(row.tooltips_dismissed);
    } catch {
      tooltipsDismissed = [];
    }

    return {
      currentStep: row.current_step as OnboardingStep,
      completedSteps,
      skipped: row.skipped === 1,
      firstOpenedAt: new Date(row.first_opened_at),
      tooltipsDismissed,
    };
  }

  /**
   * Persist onboarding state to the database via upsert.
   */
  async function saveState(userId: string, state: OnboardingState): Promise<void> {
    const existing = await db.query<{ user_id: string }>(
      'SELECT user_id FROM onboarding_state WHERE user_id = ?',
      [userId],
    );

    const completedStepsJson = JSON.stringify(state.completedSteps);
    const tooltipsDismissedJson = JSON.stringify(state.tooltipsDismissed);
    const skippedInt = state.skipped ? 1 : 0;
    const firstOpenedAtMs = state.firstOpenedAt.getTime();

    if (existing.length > 0) {
      await db.execute(
        `UPDATE onboarding_state
         SET current_step = ?, completed_steps = ?, skipped = ?, first_opened_at = ?, tooltips_dismissed = ?
         WHERE user_id = ?`,
        [state.currentStep, completedStepsJson, skippedInt, firstOpenedAtMs, tooltipsDismissedJson, userId],
      );
    } else {
      await db.execute(
        `INSERT INTO onboarding_state (user_id, current_step, completed_steps, skipped, first_opened_at, tooltips_dismissed)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, state.currentStep, completedStepsJson, skippedInt, firstOpenedAtMs, tooltipsDismissedJson],
      );
    }
  }

  /**
   * Get the current onboarding state for a user.
   * Creates initial state at the 'welcome' step if none exists (Req 11.1).
   */
  async function getOnboardingState(userId: string): Promise<OnboardingState> {
    const existing = await loadState(userId);
    if (existing) return existing;

    // First open — create initial state
    const initial: OnboardingState = {
      currentStep: 'welcome',
      completedSteps: [],
      skipped: false,
      firstOpenedAt: new Date(now()),
      tooltipsDismissed: [],
    };

    await saveState(userId, initial);
    return initial;
  }

  /**
   * Complete a step and advance to the next one.
   * The step must match the current step to prevent out-of-order completion.
   * When the last step is completed, the flow is considered done (Req 11.3).
   * Fires onComplete callback when the final step is completed.
   */
  async function completeStep(userId: string, step: OnboardingStep): Promise<void> {
    const state = await getOnboardingState(userId);

    // Only allow completing the current step
    if (state.currentStep !== step) {
      return;
    }

    // Don't re-complete already completed steps
    if (state.completedSteps.includes(step)) {
      return;
    }

    state.completedSteps.push(step);

    const next = getNextStep(step);
    if (next) {
      state.currentStep = next;
    }
    // If no next step, currentStep stays at the last step (explore_features)
    // and completedSteps.length === 4 signals completion

    await saveState(userId, state);

    // Fire completion callback when all steps are done (Req 11.3)
    if (state.completedSteps.length === ONBOARDING_STEPS.length) {
      onComplete?.(userId);
    }
  }

  /**
   * Skip the onboarding flow (Req 11.5).
   * Marks all steps as completed and sets skipped flag.
   * Fires onComplete callback since the flow is now done.
   */
  async function skipOnboarding(userId: string): Promise<void> {
    const state = await getOnboardingState(userId);

    state.skipped = true;
    state.completedSteps = [...ONBOARDING_STEPS];
    state.currentStep = ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1];

    await saveState(userId, state);

    // Fire completion callback — skipping counts as completing the flow
    onComplete?.(userId);
  }

  /**
   * Reset onboarding to the beginning (Req 11.5).
   * Accessible from the settings menu.
   */
  async function resetOnboarding(userId: string): Promise<void> {
    const state = await getOnboardingState(userId);

    state.currentStep = 'welcome';
    state.completedSteps = [];
    state.skipped = false;
    // Preserve firstOpenedAt and tooltipsDismissed — reset only affects the flow

    await saveState(userId, state);
  }

  /**
   * Whether a contextual tooltip should be shown for a feature (Req 11.4).
   * Returns true if:
   * - The user is within the first 7 days of use
   * - The tooltip for this feature has not been dismissed
   */
  async function shouldShowTooltip(userId: string, feature: string): Promise<boolean> {
    const state = await getOnboardingState(userId);

    // Check if within the 7-day tooltip period
    const elapsed = now() - state.firstOpenedAt.getTime();
    if (elapsed > TOOLTIP_DISPLAY_PERIOD_MS) {
      return false;
    }

    // Check if this tooltip has been dismissed
    return !state.tooltipsDismissed.includes(feature);
  }

  /**
   * Dismiss a contextual tooltip for a feature.
   */
  async function dismissTooltip(userId: string, feature: string): Promise<void> {
    const state = await getOnboardingState(userId);

    if (state.tooltipsDismissed.includes(feature)) {
      return; // Already dismissed
    }

    state.tooltipsDismissed.push(feature);
    await saveState(userId, state);
  }

  /**
   * Whether the onboarding flow is complete (all steps done or skipped).
   * Useful for the UI to check if it should show the Unified View directly.
   */
  async function isComplete(userId: string): Promise<boolean> {
    const state = await getOnboardingState(userId);
    return state.completedSteps.length === ONBOARDING_STEPS.length;
  }

  return {
    getOnboardingState,
    completeStep,
    skipOnboarding,
    resetOnboarding,
    isComplete,
    shouldShowTooltip,
    dismissTooltip,
  };
}

// Export helpers for testing
export { getNextStep };
