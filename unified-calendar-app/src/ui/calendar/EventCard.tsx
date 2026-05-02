/**
 * EventCard — shared event rendering component with micro-interaction
 * wiring for all calendar views.
 *
 * Centralises the animation hooks (event created, sync appear, visibility
 * toggle, press feedback, animated delete) so each view does not need to
 * duplicate the wiring. Wrapped in an AnimationErrorBoundary so worklet
 * crashes degrade gracefully to non-animated rendering.
 *
 * Requirements: 1.5, 1.6, 2.2, 2.3, 7.1, 7.2, 7.3, 7.4
 */

import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, type ViewStyle, type TextStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import type { CalendarEvent } from '../../types/models';
import { useTokens } from '../tokens/designTokens';
import {
  useEventCreatedStyle,
  useVisibilityToggleStyle,
  usePressDownStyle,
  usePressReleaseStyle,
  useEventDeletedStyle,
  useSyncAppearStyle,
} from '../animation/microInteractions';
import { useAccountVisibilityTransition } from '../animation/useAccountVisibilityTransition';
import { AnimationErrorBoundary } from '../animation/AnimationErrorBoundary';
import {
  useIsRecentlyArrivedFromSync,
  useIsPendingAnimatedDelete,
} from '../../stores/eventsStore';
import { getEventBackgroundColor, getEventBorderColor } from './colorCoding';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface EventCardProps {
  event: CalendarEvent;
  /** Resolved colour for this event's calendar account. */
  color: string;
  /** Callback when the card is pressed. */
  onPress?: (event: CalendarEvent) => void;
  /** Whether this event was just created by the user (triggers scale-up). */
  isNewlyCreated?: boolean;
  /** Optional prefix text (e.g. pattern icon for colour-blind support). */
  prefixIcon?: string;
  /** Optional children rendered after the title (e.g. time, location). */
  children?: React.ReactNode;
  /** Additional style applied to the outer animated wrapper. */
  style?: ViewStyle;
  /** Override the accessibility label. */
  accessibilityLabel?: string;
}

// ─── Inner component (hooks live here) ───────────────────────────────────────

function EventCardInner({
  event,
  color,
  onPress,
  isNewlyCreated = false,
  prefixIcon,
  children,
  style,
  accessibilityLabel,
}: EventCardProps) {
  const tokens = useTokens();

  // ── Micro-interaction hooks (always called, never conditional) ──────────

  // 1. Event created animation (Req 2.2)
  const createdStyle = useEventCreatedStyle(isNewlyCreated);

  // 2. Sync appear animation (Req 7.4)
  const isRecentSync = useIsRecentlyArrivedFromSync(event.id);
  const syncStyle = useSyncAppearStyle(isRecentSync);

  // 3. Visibility toggle animation (Req 2.3)
  const visibilityState = useAccountVisibilityTransition(event.calendarAccountId);
  const visibilityStyle = useVisibilityToggleStyle(visibilityState);

  // 4. Animated delete (Req 7.3) — reads transient pendingAnimatedDelete set
  const isPendingDelete = useIsPendingAnimatedDelete(event.id);
  const deleteStyle = useEventDeletedStyle(isPendingDelete);

  // 5. Press feedback (Req 7.1, 7.2)
  const [isPressed, setIsPressed] = useState(false);
  const [isReleased, setIsReleased] = useState(false);
  const pressDownStyle = usePressDownStyle(isPressed);
  const pressReleaseStyle = usePressReleaseStyle(isReleased);

  const handlePressIn = useCallback(() => {
    setIsPressed(true);
    setIsReleased(false);
  }, []);

  const handlePressOut = useCallback(() => {
    setIsPressed(false);
    setIsReleased(true);
  }, []);

  const handlePress = useCallback(() => {
    onPress?.(event);
  }, [onPress, event]);

  // ── Derived styles ─────────────────────────────────────────────────────

  const bgColor = getEventBackgroundColor(color);
  const borderColor = getEventBorderColor(color);

  const cardStyle: ViewStyle = {
    backgroundColor: bgColor,
    borderLeftColor: color,
    borderLeftWidth: 3,
    borderRadius: tokens.radii.sm,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.xs,
    overflow: 'hidden',
    ...style,
  };

  const titleStyle: TextStyle = {
    fontSize: tokens.typography.sizes.body - 1, // 13px
    fontWeight: tokens.typography.weights.semibold,
    color,
  };

  const label =
    accessibilityLabel ?? event.title;

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Animated.View
        style={[
          cardStyle,
          createdStyle,
          syncStyle,
          visibilityStyle,
          deleteStyle,
          pressDownStyle,
          pressReleaseStyle,
        ]}
      >
        <Text style={titleStyle} numberOfLines={1}>
          {prefixIcon ? `${prefixIcon} ` : ''}
          {event.title}
        </Text>
        {children}
      </Animated.View>
    </Pressable>
  );
}

// ─── Public component (wrapped in error boundary) ────────────────────────────

/**
 * EventCard wrapped in an AnimationErrorBoundary so Reanimated worklet
 * crashes degrade gracefully to non-animated rendering (Task 2.10).
 */
export function EventCard(props: EventCardProps) {
  return (
    <AnimationErrorBoundary>
      <EventCardInner {...props} />
    </AnimationErrorBoundary>
  );
}
