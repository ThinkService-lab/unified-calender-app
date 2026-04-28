/**
 * Onboarding type definitions.
 * Requirements: 5.1
 */

/** Steps in the onboarding flow (max 4) */
export type OnboardingStep = 'welcome' | 'connect_first_account' | 'choose_view' | 'explore_features';

export interface OnboardingState {
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  skipped: boolean;
  firstOpenedAt: Date;
  tooltipsDismissed: string[];
}
