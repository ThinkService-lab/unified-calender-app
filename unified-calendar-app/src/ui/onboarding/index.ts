/**
 * UI Onboarding module — barrel export.
 *
 * Exports the OnboardingAnimator component and the three animation demo
 * components used in the first-run experience.
 *
 * Requirements: 20.1, 20.2, 20.3
 */

// Onboarding Animator
export { default as OnboardingAnimator } from './OnboardingAnimator';
export type { OnboardingAnimatorProps } from './OnboardingAnimator';

// Animation demo components
export { default as NaturalLanguageDemo } from './animations/NaturalLanguageDemo';
export { loopDurationMs as naturalLanguageLoopDurationMs } from './animations/NaturalLanguageDemo';

export { default as DragToRescheduleDemo } from './animations/DragToRescheduleDemo';
export { loopDurationMs as dragToRescheduleLoopDurationMs } from './animations/DragToRescheduleDemo';

export { default as ViewSwitchingDemo } from './animations/ViewSwitchingDemo';
export { loopDurationMs as viewSwitchingLoopDurationMs } from './animations/ViewSwitchingDemo';
