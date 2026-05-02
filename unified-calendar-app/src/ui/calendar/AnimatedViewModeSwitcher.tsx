/**
 * AnimatedViewModeSwitcher — enhanced ViewModeSwitcher with a sliding
 * indicator behind the active tab.
 *
 * The indicator moves via a spring animation (≤250ms) using
 * Design_Token_System colors. When reduced motion is active the
 * indicator jumps instantly to the new position.
 *
 * Uses `React.createElement` instead of JSX to match the project's
 * `jsx: "react-native"` tsconfig setting which preserves JSX as-is.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTokens } from '../tokens/designTokens';
import { useAnimation } from '../animation/animationEngine';
import type { DefaultViewMode } from '../types';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Ordered view modes — the index drives the indicator position. */
const VIEW_MODES: { key: DefaultViewMode; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'agenda', label: 'Agenda' },
];

/**
 * Spring config tuned so the indicator settles within ≤250ms (Req 8.2).
 * Higher stiffness + higher damping = faster settle with minimal overshoot.
 */
const INDICATOR_SPRING = {
  damping: 20,
  stiffness: 200,
  mass: 1,
} as const;

// ─── Props ───────────────────────────────────────────────────────────────────

export interface AnimatedViewModeSwitcherProps {
  currentMode: DefaultViewMode;
  onModeChange: (mode: DefaultViewMode) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AnimatedViewModeSwitcher({
  currentMode,
  onModeChange,
}: AnimatedViewModeSwitcherProps) {
  const tokens = useTokens();
  const { shouldAnimate } = useAnimation();

  // Track each tab's measured width so the indicator can size + position itself.
  const tabWidths = useSharedValue<number[]>(new Array(VIEW_MODES.length).fill(0));

  // Shared values driving the indicator's animated position and width.
  const indicatorLeft = useSharedValue(0);
  const indicatorWidth = useSharedValue(0);

  // Derive the active index from the current mode.
  const activeIndex = useMemo(
    () => VIEW_MODES.findIndex((m) => m.key === currentMode),
    [currentMode],
  );

  // ── Measure tab widths ──────────────────────────────────────────────────

  const handleTabLayout = useCallback(
    (index: number) => (event: LayoutChangeEvent) => {
      const { width } = event.nativeEvent.layout;
      const updated = [...tabWidths.value];
      updated[index] = width;
      tabWidths.value = updated;

      // If this is the active tab, position the indicator immediately
      // (handles the initial render before any animation has run).
      if (index === activeIndex) {
        const left = computeLeft(updated, activeIndex);
        if (shouldAnimate) {
          indicatorLeft.value = withSpring(left, INDICATOR_SPRING);
          indicatorWidth.value = withSpring(width, INDICATOR_SPRING);
        } else {
          indicatorLeft.value = withTiming(left, { duration: 0 });
          indicatorWidth.value = withTiming(width, { duration: 0 });
        }
      }
    },
    [activeIndex, shouldAnimate, indicatorLeft, indicatorWidth, tabWidths],
  );

  // ── Animate indicator when active tab changes ───────────────────────────

  useEffect(() => {
    const widths = tabWidths.value;
    const targetWidth = widths[activeIndex] ?? 0;
    const targetLeft = computeLeft(widths, activeIndex);

    if (shouldAnimate) {
      indicatorLeft.value = withSpring(targetLeft, INDICATOR_SPRING);
      indicatorWidth.value = withSpring(targetWidth, INDICATOR_SPRING);
    } else {
      // Reduced motion: instant position change (Req 8.4).
      indicatorLeft.value = withTiming(targetLeft, { duration: 0 });
      indicatorWidth.value = withTiming(targetWidth, { duration: 0 });
    }
  }, [activeIndex, shouldAnimate, indicatorLeft, indicatorWidth, tabWidths]);

  // ── Animated style for the sliding indicator ────────────────────────────

  const indicatorStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    left: indicatorLeft.value,
    width: indicatorWidth.value,
    top: 2,
    bottom: 2,
    borderRadius: 6,
  }));

  // ── Dynamic styles derived from tokens (Req 8.3) ───────────────────────

  const containerStyle = useMemo(
    () => ({
      flexDirection: 'row' as const,
      backgroundColor: tokens.colors.borderLight,
      borderRadius: tokens.radii.md,
      padding: 2,
      alignSelf: 'center' as const,
    }),
    [tokens],
  );

  const indicatorBgStyle = useMemo(
    () => ({
      backgroundColor: tokens.colors.surface,
      ...(Platform.OS === 'web'
        ? ({ boxShadow: '0 1px 3px rgba(0,0,0,0.12)' } as any)
        : tokens.shadows.sm),
    }),
    [tokens],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  return React.createElement(
    View,
    {
      style: containerStyle,
      accessibilityRole: 'tablist',
      accessibilityLabel: 'Calendar view mode',
    },
    // Sliding indicator (behind tabs)
    React.createElement(Animated.View, {
      style: [indicatorStyle, indicatorBgStyle],
      pointerEvents: 'none',
      testID: 'view-mode-indicator',
    }),
    // Tab buttons
    ...VIEW_MODES.map(({ key, label }, index) => {
      const isActive = currentMode === key;
      return React.createElement(
        TouchableOpacity,
        {
          key,
          style: styles.tab,
          onPress: () => onModeChange(key),
          onLayout: handleTabLayout(index),
          accessibilityRole: 'tab',
          accessibilityState: { selected: isActive },
          accessibilityLabel: `${label} view`,
          activeOpacity: 0.7,
          testID: `view-mode-tab-${key}`,
        },
        React.createElement(
          Text,
          {
            style: [
              styles.tabText,
              {
                color: isActive
                  ? tokens.colors.primary
                  : tokens.colors.textSecondary,
                fontWeight: isActive
                  ? tokens.typography.weights.semibold
                  : tokens.typography.weights.medium,
              },
            ],
          },
          label,
        ),
      );
    }),
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Compute the left offset for the indicator at `targetIndex`. */
function computeLeft(widths: number[], targetIndex: number): number {
  let left = 0;
  for (let i = 0; i < targetIndex; i++) {
    left += widths[i] ?? 0;
  }
  return left;
}

// ─── Static styles ───────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 56,
    alignItems: 'center',
  },
  tabText: {
    fontSize: 13,
  },
});
