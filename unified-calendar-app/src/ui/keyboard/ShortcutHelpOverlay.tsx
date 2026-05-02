/**
 * ShortcutHelpOverlay — modal overlay listing all keyboard shortcuts
 * grouped by category (navigation, creation, view switching).
 *
 * Triggered by pressing `?` via the Keyboard_Shortcut_Manager.
 *
 * Entrance animation: fade-in + scale-up from 0.95 to 1.0 (200ms).
 * Exit animation: fade-out + scale-down to 0.95 (150ms).
 * Reduced motion: instant show/hide, no scale animation.
 *
 * Accessibility:
 *   - role="dialog", aria-modal="true", aria-label="Keyboard shortcuts"
 *   - Focus trapped within the overlay while visible (useFocusTrap)
 *   - Close button with aria-label="Close shortcuts overlay"
 *   - Each category section uses role="group" with aria-label
 *
 * Web-only component (Platform.OS === 'web').
 *
 * Requirements: 11.5, 11.6
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import type { ViewStyle, TextStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';

import { useTokens } from '../tokens';
import { useReducedMotion, useFocusTrap } from '../accessibility/useAccessibility';
import type { ShortcutDefinition } from './useKeyboardShortcuts';

// ─── Public types ────────────────────────────────────────────────────────────

export interface ShortcutHelpOverlayProps {
  /** Whether the overlay is visible */
  visible: boolean;
  /** All registered shortcuts grouped by category */
  shortcuts: Record<'navigation' | 'creation' | 'view-switching', ShortcutDefinition[]>;
  /** Callback to dismiss the overlay (triggered by Escape key or backdrop press) */
  onDismiss: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Entrance animation duration (ms). */
const ENTRANCE_DURATION_MS = 200;

/** Exit animation duration (ms). */
const EXIT_DURATION_MS = 150;

/** Scale value for entrance/exit animation start/end. */
const SCALE_FROM = 0.95;

/** Category display names. */
const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  navigation: 'Navigation',
  creation: 'Creation',
  'view-switching': 'View Switching',
};

/** Category render order. */
const CATEGORY_ORDER: Array<'navigation' | 'creation' | 'view-switching'> = [
  'navigation',
  'creation',
  'view-switching',
];

// ─── Key display mapping ─────────────────────────────────────────────────────

/**
 * Maps raw key names to user-friendly display strings.
 * Keys not in this map are displayed as-is (uppercased single chars).
 */
const KEY_DISPLAY_MAP: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
};

/** Returns a user-friendly display string for a shortcut key. */
function getKeyDisplay(key: string): string {
  if (KEY_DISPLAY_MAP[key]) return KEY_DISPLAY_MAP[key];
  // Single character keys are displayed uppercase
  if (key.length === 1) return key.toUpperCase();
  return key;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ShortcutHelpOverlay({
  visible,
  shortcuts,
  onDismiss,
}: ShortcutHelpOverlayProps): React.ReactElement | null {
  const tokens = useTokens();
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLElement | null>(null);

  // Focus trap when visible (web only)
  useFocusTrap(containerRef, visible);

  // ── Animation shared values ─────────────────────────────────────────────
  const opacity = useSharedValue(0);
  const scale = useSharedValue(SCALE_FROM);

  // Track whether the overlay should be rendered in the DOM.
  // Uses state (not a ref) so that clearing it after the exit animation
  // triggers a re-render that unmounts the overlay nodes.
  const [isRendered, setIsRendered] = useState(visible);

  useEffect(() => {
    if (visible) {
      setIsRendered(true);

      if (reducedMotion) {
        opacity.value = 1;
        scale.value = 1;
      } else {
        opacity.value = withTiming(1, { duration: ENTRANCE_DURATION_MS });
        scale.value = withTiming(1, { duration: ENTRANCE_DURATION_MS });
      }
    } else {
      if (reducedMotion) {
        opacity.value = 0;
        scale.value = SCALE_FROM;
        setIsRendered(false);
      } else {
        opacity.value = withTiming(0, { duration: EXIT_DURATION_MS });
        scale.value = withTiming(SCALE_FROM, { duration: EXIT_DURATION_MS });
        // Delay unmount until exit animation completes
        const timer = setTimeout(() => {
          setIsRendered(false);
        }, EXIT_DURATION_MS);
        return () => clearTimeout(timer);
      }
    }
  }, [visible, reducedMotion, opacity, scale]);

  // ── Animated styles ─────────────────────────────────────────────────────
  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const dialogAnimatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  // Don't render anything when not visible and animation is complete
  if (!visible && !isRendered) {
    return null;
  }

  // ── Token-driven styles ─────────────────────────────────────────────────
  const backdropStyle: ViewStyle = {
    ...styles.backdrop,
    backgroundColor: 'rgba(0,0,0,0.4)',
  };

  const dialogStyle: ViewStyle = {
    ...styles.dialog,
    backgroundColor: tokens.colors.surface,
    borderRadius: tokens.radii.lg,
    padding: tokens.spacing.xl,
    ...tokens.shadows.lg,
  };

  const titleStyle: TextStyle = {
    ...styles.title,
    color: tokens.colors.textPrimary,
    fontSize: tokens.typography.sizes.heading,
    lineHeight: tokens.typography.lineHeights.heading,
    fontWeight: tokens.typography.weights.bold,
    fontFamily: tokens.typography.fontFamily.primary,
  };

  const categoryHeaderStyle: TextStyle = {
    ...styles.categoryHeader,
    color: tokens.colors.textPrimary,
    fontSize: tokens.typography.sizes.subheading,
    lineHeight: tokens.typography.lineHeights.subheading,
    fontWeight: tokens.typography.weights.semibold,
    fontFamily: tokens.typography.fontFamily.primary,
    marginBottom: tokens.spacing.sm,
  };

  const keyBadgeStyle: ViewStyle = {
    ...styles.keyBadge,
    backgroundColor: tokens.colors.surfaceElevated,
    borderRadius: tokens.radii.sm,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: 2,
    marginRight: tokens.spacing.md,
  };

  const keyBadgeTextStyle: TextStyle = {
    ...styles.keyBadgeText,
    color: tokens.colors.textPrimary,
    fontSize: tokens.typography.sizes.body,
    lineHeight: tokens.typography.lineHeights.body,
    fontFamily: tokens.typography.fontFamily.mono,
  };

  const shortcutLabelStyle: TextStyle = {
    ...styles.shortcutLabel,
    color: tokens.colors.textPrimary,
    fontSize: tokens.typography.sizes.body,
    lineHeight: tokens.typography.lineHeights.body,
    fontFamily: tokens.typography.fontFamily.primary,
  };

  const closeButtonStyle: ViewStyle = {
    ...styles.closeButton,
    padding: tokens.spacing.xs,
    marginLeft: tokens.spacing.sm,
  };

  const closeButtonTextStyle: TextStyle = {
    ...styles.closeButtonText,
    color: tokens.colors.textSecondary,
    fontSize: tokens.typography.sizes.heading,
    lineHeight: tokens.typography.lineHeights.heading,
    fontFamily: tokens.typography.fontFamily.primary,
  };

  // ── Build category sections ─────────────────────────────────────────────
  const categorySections: React.ReactElement[] = [];

  for (const category of CATEGORY_ORDER) {
    const items = shortcuts[category];
    if (!items || items.length === 0) continue;

    const displayName = CATEGORY_DISPLAY_NAMES[category] ?? category;

    const shortcutRows: React.ReactElement[] = items.map((shortcut, idx) =>
      React.createElement(
        View,
        {
          key: `${category}-${shortcut.key}-${idx}`,
          style: [styles.shortcutRow, { paddingVertical: tokens.spacing.xs }],
        },
        React.createElement(
          View,
          { style: keyBadgeStyle },
          React.createElement(
            Text,
            { style: keyBadgeTextStyle },
            getKeyDisplay(shortcut.key),
          ),
        ),
        React.createElement(
          Text,
          { style: shortcutLabelStyle },
          shortcut.label,
        ),
      ),
    );

    categorySections.push(
      React.createElement(
        View,
        {
          key: `category-${category}`,
          style: [styles.categorySection, { marginBottom: tokens.spacing.lg }],
          ...(Platform.OS === 'web'
            ? { role: 'group', 'aria-label': displayName } as any
            : { accessibilityRole: 'none', accessibilityLabel: displayName }),
        },
        React.createElement(
          Text,
          { style: categoryHeaderStyle },
          displayName,
        ),
        ...shortcutRows,
      ),
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return React.createElement(
    Animated.View,
    {
      style: [backdropStyle, backdropAnimatedStyle],
      testID: 'shortcut-help-backdrop',
      ...(Platform.OS === 'web'
        ? {
            onClick: (e: any) => {
              // Only dismiss if clicking the backdrop itself, not the dialog
              if (e.target === e.currentTarget) {
                onDismiss();
              }
            },
          } as any
        : {}),
    },
    React.createElement(
      Animated.View,
      {
        ref: containerRef as any,
        style: [dialogStyle, dialogAnimatedStyle],
        testID: 'shortcut-help-dialog',
        ...(Platform.OS === 'web'
          ? {
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': 'Keyboard shortcuts',
            } as any
          : {
              accessibilityRole: 'none',
              accessibilityLabel: 'Keyboard shortcuts',
            }),
      },
      // Header row: title + close button
      React.createElement(
        View,
        { style: [styles.headerRow, { marginBottom: tokens.spacing.lg }] },
        React.createElement(
          Text,
          { style: titleStyle },
          'Keyboard Shortcuts',
        ),
        React.createElement(
          Pressable,
          {
            onPress: onDismiss,
            style: closeButtonStyle,
            accessible: true,
            accessibilityRole: 'button',
            accessibilityLabel: 'Close shortcuts overlay',
            testID: 'shortcut-help-close-button',
            ...(Platform.OS === 'web'
              ? { 'aria-label': 'Close shortcuts overlay' } as any
              : {}),
          },
          React.createElement(
            Text,
            { style: closeButtonTextStyle },
            '✕',
          ),
        ),
      ),
      // Category sections
      ...categorySections,
    ),
  );
}

// ─── Static styles ───────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    maxWidth: 480,
    width: '90%' as any,
    maxHeight: '80%' as any,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    flex: 1,
  },
  closeButton: {},
  closeButtonText: {
    textAlign: 'center',
  },
  categorySection: {},
  categoryHeader: {},
  shortcutRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  keyBadge: {
    minWidth: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyBadgeText: {
    textAlign: 'center',
  },
  shortcutLabel: {},
});

export default ShortcutHelpOverlay;
