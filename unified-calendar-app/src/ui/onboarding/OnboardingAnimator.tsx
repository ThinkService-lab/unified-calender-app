/**
 * OnboardingAnimator — first-run experience presenting animated screens
 * that showcase the app's key capabilities.
 *
 * Screens:
 *   1. Natural language event creation (NaturalLanguageDemo)
 *   2. Drag-to-reschedule (DragToRescheduleDemo)
 *   3. View switching (ViewSwitchingDemo)
 *
 * Each screen renders its animation component with `isPlaying` gated to
 * the currently visible screen index. Progress dots, Next/Skip buttons,
 * and horizontal slide transitions (300ms) are included.
 *
 * On complete or skip the component persists state via the injected
 * `OnboardingManager` and fires the `onComplete` callback so the host
 * can transition to the main calendar view.
 *
 * Reduced motion: static fallback images (handled internally by the
 * animation components), instant screen transitions (no slide).
 *
 * Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9
 */

import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';

import { useAnimation } from '../animation/animationEngine';
import { useTokens } from '../tokens/designTokens';
import type { OnboardingManager } from '../../onboarding/onboardingManager';
import type { OnboardingStep } from '../../types/onboarding';

import NaturalLanguageDemo from './animations/NaturalLanguageDemo';
import DragToRescheduleDemo from './animations/DragToRescheduleDemo';
import ViewSwitchingDemo from './animations/ViewSwitchingDemo';

// ─── Screen definitions ──────────────────────────────────────────────────────

interface OnboardingScreenDef {
  id: string;
  title: string;
  description: string;
  animationComponent: React.ComponentType<{ isPlaying: boolean }>;
  accessibilityLabel: string;
}

const SCREENS: readonly OnboardingScreenDef[] = [
  {
    id: 'nl-creation',
    title: 'Create events naturally',
    description: "Just type what you want — we'll figure out the details",
    animationComponent: NaturalLanguageDemo,
    accessibilityLabel:
      "Demonstration of typing 'Lunch tomorrow at noon' in the Quick Create Bar",
  },
  {
    id: 'drag-reschedule',
    title: 'Drag to reschedule',
    description: 'Long-press any event and drag it to a new time',
    animationComponent: DragToRescheduleDemo,
    accessibilityLabel:
      'Demonstration of dragging an event to a new time slot to reschedule it',
  },
  {
    id: 'view-switching',
    title: 'Switch views instantly',
    description:
      'Swipe or tap to move between day, week, and month views',
    animationComponent: ViewSwitchingDemo,
    accessibilityLabel:
      'Demonstration of switching between day view and week view with animated transitions',
  },
] as const;

/** The onboarding steps to mark complete when the user finishes all screens. */
const ONBOARDING_STEPS_TO_COMPLETE: readonly OnboardingStep[] = [
  'welcome',
  'connect_first_account',
  'choose_view',
  'explore_features',
];

// ─── Props ───────────────────────────────────────────────────────────────────

export interface OnboardingAnimatorProps {
  /** Callback when onboarding completes or is skipped — host transitions to main view. */
  onComplete: () => void;
  /** The OnboardingManager instance used to persist completion/skip state. */
  onboardingManager: OnboardingManager;
  /** The current user's ID, forwarded to OnboardingManager methods. */
  userId: string;
}

// ─── Transition duration ─────────────────────────────────────────────────────

const SLIDE_DURATION_MS = 300;

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Animated first-run onboarding experience.
 */
export default function OnboardingAnimator({
  onComplete,
  onboardingManager,
  userId,
}: OnboardingAnimatorProps) {
  const { shouldAnimate } = useAnimation();
  const tokens = useTokens();
  const [currentScreen, setCurrentScreen] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Gap 7 fix: use reactive window dimensions instead of static Dimensions.get()
  const { width: screenWidth } = useWindowDimensions();

  // Shared value driving the horizontal offset of the screen strip
  const translateX = useSharedValue(0);

  const isLastScreen = currentScreen === SCREENS.length - 1;

  // ── Slide transition helper ──────────────────────────────────────────────

  const slideTo = useCallback(
    (index: number) => {
      if (isTransitioning) return;

      if (!shouldAnimate) {
        // Reduced motion: instant transition
        translateX.value = -index * screenWidth;
        setCurrentScreen(index);
        return;
      }

      setIsTransitioning(true);
      translateX.value = withTiming(-index * screenWidth, {
        duration: SLIDE_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      });

      // Update state after the animation completes
      setTimeout(() => {
        setCurrentScreen(index);
        setIsTransitioning(false);
      }, SLIDE_DURATION_MS);
    },
    [isTransitioning, shouldAnimate, translateX, screenWidth],
  );

  // ── Handlers ─────────────────────────────────────────────────────────────

  // Gap 6 fix: wrap async persistence in try/catch so failures don't strand the user
  const handleNext = useCallback(async () => {
    if (isTransitioning) return;

    if (isLastScreen) {
      try {
        // Complete: persist each step sequentially, then fire callback
        for (const step of ONBOARDING_STEPS_TO_COMPLETE) {
          await onboardingManager.completeStep(userId, step);
        }
      } catch {
        // Persistence failed — still transition to the main view so the user
        // isn't stuck. Onboarding may re-appear on next launch, which is
        // acceptable degradation.
      }
      onComplete();
    } else {
      slideTo(currentScreen + 1);
    }
  }, [
    isTransitioning,
    isLastScreen,
    onboardingManager,
    userId,
    onComplete,
    slideTo,
    currentScreen,
  ]);

  const handleSkip = useCallback(async () => {
    if (isTransitioning) return;
    try {
      await onboardingManager.skipOnboarding(userId);
    } catch {
      // Same degradation as handleNext — proceed to main view regardless
    }
    onComplete();
  }, [isTransitioning, onboardingManager, userId, onComplete]);

  // ── Gap 1 fix: swipe-to-advance gesture (Req 20.5) ──────────────────────

  const handleSwipeEnd = useCallback(
    (translationX: number, translationY: number) => {
      const SWIPE_THRESHOLD = 50;
      if (Math.abs(translationX) < SWIPE_THRESHOLD) return;
      if (Math.abs(translationX) <= Math.abs(translationY)) return;

      if (translationX < -SWIPE_THRESHOLD && currentScreen < SCREENS.length - 1) {
        slideTo(currentScreen + 1);
      } else if (translationX > SWIPE_THRESHOLD && currentScreen > 0) {
        slideTo(currentScreen - 1);
      }
    },
    [currentScreen, slideTo],
  );

  const panGesture = Gesture.Pan()
    .activeOffsetX([-30, 30])
    .onEnd((event) => {
      'worklet';
      const { translationX, translationY } = event;
      runOnJS(handleSwipeEnd)(translationX, translationY);
    });

  // ── Animated styles ──────────────────────────────────────────────────────

  const stripStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // ── Dynamic styles from tokens ───────────────────────────────────────────

  const { colors, typography: typo, spacing, radii } = tokens;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <GestureDetector gesture={panGesture}>
      <View style={[styles.root, { backgroundColor: colors.background }]} accessibilityRole="none">
        {/* Screen strip */}
        <Animated.View
          style={[
            styles.strip,
            { width: screenWidth * SCREENS.length },
            stripStyle,
          ]}
        >
          {SCREENS.map((screen, index) => {
            const AnimComponent = screen.animationComponent;
            return (
              <View
                key={screen.id}
                style={[styles.screen, { width: screenWidth, paddingHorizontal: spacing.lg }]}
                accessibilityRole="none"
              >
                {/* Animation area */}
                <View
                  style={styles.animationContainer}
                  accessible
                  accessibilityRole="image"
                  accessibilityLabel={screen.accessibilityLabel}
                >
                  <AnimComponent isPlaying={currentScreen === index} />
                </View>

                {/* Text content */}
                <View style={[styles.textContainer, { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl }]}>
                  <Text style={{
                    fontFamily: typo.fontFamily.primary,
                    fontSize: typo.sizes.title,
                    fontWeight: typo.weights.bold,
                    color: colors.textPrimary,
                    textAlign: 'center',
                    marginBottom: spacing.sm,
                  }}>{screen.title}</Text>
                  <Text style={{
                    fontFamily: typo.fontFamily.primary,
                    fontSize: typo.sizes.body,
                    lineHeight: typo.lineHeights.body,
                    color: colors.textSecondary,
                    textAlign: 'center',
                  }}>{screen.description}</Text>
                </View>
              </View>
            );
          })}
        </Animated.View>

        {/* Bottom controls */}
        <View style={[styles.controls, { paddingHorizontal: spacing.xl, paddingBottom: spacing['2xl'] }]}>
          {/* Progress dots */}
          <View
            style={[styles.dotsContainer, { marginBottom: spacing.lg }]}
            accessible
            accessibilityRole="text"
            accessibilityLabel={`Screen ${currentScreen + 1} of ${SCREENS.length}`}
          >
            {SCREENS.map((screen, index) => (
              <View
                key={screen.id}
                style={[
                  styles.dot,
                  { borderRadius: radii.full, marginHorizontal: spacing.xs },
                  index === currentScreen
                    ? { backgroundColor: colors.primary }
                    : { backgroundColor: colors.border },
                ]}
              />
            ))}
          </View>

          {/* Buttons */}
          <View style={styles.buttonsRow}>
            <Pressable
              onPress={handleSkip}
              style={{ paddingVertical: spacing.md, paddingHorizontal: spacing.lg }}
              accessibilityRole="button"
              accessibilityLabel="Skip"
            >
              <Text style={{
                fontFamily: typo.fontFamily.primary,
                fontSize: typo.sizes.body,
                fontWeight: typo.weights.medium,
                color: colors.textMuted,
              }}>Skip</Text>
            </Pressable>

            <Pressable
              onPress={handleNext}
              style={{
                backgroundColor: colors.primary,
                paddingVertical: spacing.md,
                paddingHorizontal: spacing.xl,
                borderRadius: radii.md,
              }}
              accessibilityRole="button"
              accessibilityLabel={isLastScreen ? 'Get Started' : 'Next'}
            >
              <Text style={{
                fontFamily: typo.fontFamily.primary,
                fontSize: typo.sizes.body,
                fontWeight: typo.weights.semibold,
                color: colors.textOnPrimary,
              }}>
                {isLastScreen ? 'Get Started' : 'Next'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </GestureDetector>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
  },
  strip: {
    flex: 1,
    flexDirection: 'row',
  },
  screen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  animationContainer: {
    flex: 1,
    width: '100%',
    maxHeight: '55%',
  },
  textContainer: {
    alignItems: 'center',
  },
  controls: {
    alignItems: 'center',
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  dot: {
    width: 8,
    height: 8,
  },
  buttonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
});
