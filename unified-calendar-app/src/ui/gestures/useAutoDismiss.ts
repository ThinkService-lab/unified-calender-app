/**
 * `useAutoDismiss` — timer-driven lifecycle for transient messages.
 *
 * Used by `<AutoDismissBanner />` (and any other component that needs
 * to show a message for a fixed duration and then hide it) to manage
 * the show → wait → fade-out → dismiss cycle.
 *
 * State flow:
 *
 *   (1) `message` becomes a non-null string
 *         → `isVisible = true`
 *           `displayMessage = message`
 *           `isFadingOut = false`
 *         → start a `setTimeout(duration)` — the "display" timer.
 *
 *   (2) Display timer fires
 *         → `isFadingOut = true`
 *         → start a `setTimeout(fadeOutDuration)` — the "fade-out" timer.
 *
 *   (3) Fade-out timer fires
 *         → `isVisible = false`
 *           `isFadingOut = false`
 *           `displayMessage = null`
 *         → call `onDismiss()`.
 *
 *   (4) If `message` changes to a new non-null string while visible:
 *         → clear both timers
 *         → reset to step (1) with the new message so the user sees the
 *           fresh message for the full `duration` again.
 *
 *   (5) If `message` becomes null externally while visible:
 *         → skip the display timer
 *         → transition straight into the fade-out phase (step 2).
 *
 *   (6) `dismiss()` can be called imperatively for manual early
 *       dismissal. It jumps to the fade-out phase from whatever state
 *       the hook is in (display or already-fading-out re-enters fade).
 *
 *   (7) On unmount: all timers are cleared so we never setState on a
 *       torn-down component.
 *
 * Why React state (not Reanimated shared values)? Consumers of this hook
 * need to conditionally render DOM nodes based on `isVisible` — a
 * shared value can't gate a React render directly. The fade-out itself
 * is rendered by the consuming component using `isFadingOut` as an
 * animation driver; this hook only manages the timer state machine.
 *
 * Requirements: 9.4 (3s display + 200ms fade-out), 2.5 (consumers must
 * honour reduced motion; this hook is unaware of motion preferences).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ─── Public types ────────────────────────────────────────────────────────────

export interface UseAutoDismissConfig {
  /** The message to display. `null` hides the banner. */
  message: string | null;
  /** Duration to show the banner before auto-dismiss (ms). Default 3000. */
  duration?: number;
  /** Duration of the fade-out animation (ms). Default 200. */
  fadeOutDuration?: number;
  /** Callback invoked after the banner has fully dismissed. */
  onDismiss?: () => void;
}

export interface UseAutoDismissReturn {
  /** Whether the banner should be rendered at all. */
  isVisible: boolean;
  /** Whether the banner is currently in its fade-out phase. */
  isFadingOut: boolean;
  /**
   * The current message text — captured on show so the fade-out
   * animation keeps showing the outgoing message even if the consumer's
   * `message` prop has already flipped to `null`.
   */
  displayMessage: string | null;
  /** Imperatively dismiss the banner early (e.g. on user tap). */
  dismiss: () => void;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_DURATION_MS = 3000;
const DEFAULT_FADE_OUT_MS = 200;

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAutoDismiss(
  config: UseAutoDismissConfig,
): UseAutoDismissReturn {
  const duration = config.duration ?? DEFAULT_DURATION_MS;
  const fadeOutDuration = config.fadeOutDuration ?? DEFAULT_FADE_OUT_MS;

  const [isVisible, setIsVisible] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [displayMessage, setDisplayMessage] = useState<string | null>(null);

  // Two timers: one for the "display" phase (duration) and one for the
  // "fade-out" phase (fadeOutDuration). Stored in refs so the effect's
  // dependency list stays minimal and we can cancel from both the
  // effect's cleanup and from `dismiss()`.
  const displayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeOutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the latest `onDismiss` in a ref so we can invoke it from the
  // fade-out timeout without forcing the effect below to re-run every
  // time the caller's callback identity changes. Consumers that pass
  // inline arrow functions would otherwise restart the display timer
  // on every parent render.
  const onDismissRef = useRef<(() => void) | undefined>(config.onDismiss);
  useEffect(() => {
    onDismissRef.current = config.onDismiss;
  }, [config.onDismiss]);

  const clearAllTimers = useCallback(() => {
    if (displayTimerRef.current !== null) {
      clearTimeout(displayTimerRef.current);
      displayTimerRef.current = null;
    }
    if (fadeOutTimerRef.current !== null) {
      clearTimeout(fadeOutTimerRef.current);
      fadeOutTimerRef.current = null;
    }
  }, []);

  /**
   * Shared transition into the "fully dismissed" end state — used by
   * both the fade-out timer and cleanup paths. Clears every local
   * state flag and fires the caller's onDismiss.
   */
  const finalizeDismiss = useCallback(() => {
    setIsVisible(false);
    setIsFadingOut(false);
    setDisplayMessage(null);
    onDismissRef.current?.();
  }, []);

  /**
   * Transition from the "display" phase into the "fade-out" phase.
   * Schedules the final dismissal after `fadeOutDuration` ms.
   */
  const startFadeOut = useCallback(() => {
    // Already fading out — don't re-queue another dismissal timer.
    if (fadeOutTimerRef.current !== null) return;

    setIsFadingOut(true);

    // If the consumer opts in to instant dismissal (fadeOutDuration === 0),
    // collapse the two phases into one tick.
    if (fadeOutDuration <= 0) {
      finalizeDismiss();
      return;
    }

    fadeOutTimerRef.current = setTimeout(() => {
      fadeOutTimerRef.current = null;
      finalizeDismiss();
    }, fadeOutDuration);
  }, [fadeOutDuration, finalizeDismiss]);

  // Main effect: react to `message` changes and drive the timer state
  // machine accordingly.
  //
  // We key off the message identity — any new non-null string resets
  // the display timer so the fresh message gets the full `duration`.
  // Switching from non-null to null immediately transitions into the
  // fade-out phase (step 5 of the state flow above).
  useEffect(() => {
    if (config.message === null) {
      // External null while visible: start fade-out immediately
      // (skipping the display phase). If we're not visible at all,
      // there's nothing to do.
      if (isVisible) {
        // Cancel the display timer if it's still pending — we're
        // jumping past the display phase.
        if (displayTimerRef.current !== null) {
          clearTimeout(displayTimerRef.current);
          displayTimerRef.current = null;
        }
        startFadeOut();
      }
      return;
    }

    // New non-null message: reset state and (re)start the display timer.
    clearAllTimers();
    setIsVisible(true);
    setIsFadingOut(false);
    setDisplayMessage(config.message);

    // If the consumer sets duration to 0 or less, skip the display
    // phase and go straight to fade-out. This is a degenerate but
    // documented configuration.
    if (duration <= 0) {
      startFadeOut();
      return;
    }

    displayTimerRef.current = setTimeout(() => {
      displayTimerRef.current = null;
      startFadeOut();
    }, duration);

    // The cleanup below cancels timers on unmount and before each
    // re-run. We intentionally DON'T include `isVisible` / `startFadeOut`
    // in the dep list — `isVisible` is state we author here so including
    // it would double-run the effect on state transitions, and
    // `startFadeOut` is stable per `fadeOutDuration` change which is
    // already covered via the closure capture. The standard React
    // pattern here is: depend on the inputs that drive the machine
    // (`message`, `duration`), and use refs for everything else.
    //
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.message, duration]);

  // Cleanup on unmount — always cancel timers. Keeping this in a
  // dedicated effect (rather than the body effect's cleanup) so it
  // only runs once on teardown, not on every `message`/`duration`
  // change.
  useEffect(() => {
    return () => {
      clearAllTimers();
    };
  }, [clearAllTimers]);

  const dismiss = useCallback(() => {
    // Manual dismissal: cancel the display timer if it's still pending
    // and transition straight into the fade-out phase. If we're not
    // visible at all this is a no-op.
    if (!isVisible) return;
    if (displayTimerRef.current !== null) {
      clearTimeout(displayTimerRef.current);
      displayTimerRef.current = null;
    }
    startFadeOut();
  }, [isVisible, startFadeOut]);

  return {
    isVisible,
    isFadingOut,
    displayMessage,
    dismiss,
  };
}
