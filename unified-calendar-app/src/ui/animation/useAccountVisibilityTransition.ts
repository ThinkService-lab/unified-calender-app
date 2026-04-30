/**
 * `useAccountVisibilityTransition` — per-EventCard hook that detects when
 * the given account's visibility flips between hidden and visible, and
 * returns a transient state for 200ms so the card can play the matching
 * fade-in / fade-out micro-interaction.
 *
 * Usage inside an EventCard:
 *   const transition = useAccountVisibilityTransition(event.calendarAccountId);
 *   const { visibilityToggle } = useMicroInteractions();
 *   const animatedStyle = visibilityToggle(transition);
 *   return <Animated.View style={animatedStyle}>…</Animated.View>;
 *
 * Implementation:
 *  - Subscribe to `hiddenAccountIds` via an atomic Zustand selector so
 *    only EventCards belonging to the toggled account re-render.
 *  - Store the previous hidden-flag in a `useRef` and detect the flip
 *    edge on each render.
 *  - On flip: set a transient state ('fading-in' when the account
 *    becomes visible, 'fading-out' when hidden) and schedule an
 *    auto-clear back to 'idle' after 200ms (matches Req 2.3).
 *  - When reduced motion is active, always return 'idle' so the
 *    EventCard re-renders without any animation.
 *
 * Requirement: 2.3
 */

import { useEffect, useRef, useState } from 'react';
import { useIsAccountHidden } from '../../stores/calendarAccountsStore';
import { useReducedMotion } from '../accessibility/useAccessibility';

export type AccountVisibilityTransitionState =
  | 'idle'
  | 'fading-in'
  | 'fading-out';

/** Duration the transient flag stays set before auto-reverting to 'idle'. */
const TRANSITION_DURATION_MS = 200;

export function useAccountVisibilityTransition(
  accountId: string,
): AccountVisibilityTransitionState {
  const isHidden = useIsAccountHidden(accountId);
  const reducedMotion = useReducedMotion();
  const prevHiddenRef = useRef<boolean>(isHidden);
  const [transition, setTransition] =
    useState<AccountVisibilityTransitionState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const previous = prevHiddenRef.current;
    prevHiddenRef.current = isHidden;

    // No flip — nothing to animate.
    if (previous === isHidden) return;

    // Reduced motion — skip the fade entirely; EventCard simply re-renders.
    if (reducedMotion) {
      setTransition('idle');
      return;
    }

    // Clear any in-flight timer from a rapid re-toggle before scheduling
    // the new one, otherwise the second transition could be short-cut.
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // Hidden → visible = fading-in; Visible → hidden = fading-out.
    setTransition(isHidden ? 'fading-out' : 'fading-in');

    timerRef.current = setTimeout(() => {
      setTransition('idle');
      timerRef.current = null;
    }, TRANSITION_DURATION_MS);
  }, [isHidden, reducedMotion]);

  // Clean up pending timers on unmount so we do not setState on a
  // torn-down component.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return transition;
}
