/**
 * Onboarding module.
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */

export {
  createOnboardingManager,
  getNextStep,
  ONBOARDING_STEPS,
  TOOLTIP_DISPLAY_PERIOD_MS,
} from './onboardingManager';
export type {
  OnboardingManager,
  OnboardingManagerConfig,
} from './onboardingManager';
