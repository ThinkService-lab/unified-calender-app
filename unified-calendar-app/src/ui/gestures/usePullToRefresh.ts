/**
 * usePullToRefresh
 *
 * Pull-to-refresh gesture controller. Returns a `PanGesture` that, when
 * pulled downward by at least `triggerDistance` pixels, fires the
 * supplied `onSync` callback. While the sync is in progress a rotating
 * indicator style is exposed for consumers to render; on completion the
 * indicator fades out over 200ms and the spring returns the gesture
 * state to rest.
 *
 * ─── Design choices ──────────────────────────────────────────────────────────
 *
 * Scroll-position gating. A PanGesture on its own does not know the
 * scroll position of its parent view. Callers that render this hook
 * inside a scrollable container are expected to conditionally attach
 * the gesture to a detector only while the scrollable is at its top
 * (e.g. by reading `contentOffset.y <= 0`). The hook itself intentionally
 * does NOT attempt to detect scroll state — it would otherwise couple
 * tightly to one scroll-view implementation and block reuse with FlatList,
 * ScrollView, and custom virtualized lists.
 *
 * Trigger check. The threshold is measured against `event.translationY`
 * (raw vertical translation) rather than a derived "visible pull distance".
 * This mirrors the design doc note: a simple comparison to the 80px
 * constant is the right primitive, and callers that want resistance for
 * polish should apply it in their presentation layer (e.g. in the
 * `indicatorStyle` composition) without changing the trigger semantics.
 *
 * Sync-lock (Req 9.5). Two guards ensure additional pulls are ignored
 * while a sync is already in progress:
 *   1. The consumer-supplied `config.isSyncing` flag. Captured as a
 *      primitive snapshot in the gesture's `.onEnd` worklet via a shared
 *      value so the UI thread can read it without bridging on every
 *      gesture update.
 *   2. Internal `isRefreshing` state managed by the hook. This covers
 *      the window between `onSync()` being called and the consumer's
 *      `isSyncing` flag propagating back through React state. Without
 *      this, two quick pulls released in the same frame could both
 *      satisfy `!config.isSyncing` and fire `onSync` twice.
 *
 * Reduced motion (Req 2.5). When `shouldAnimate` is `false`, we skip the
 * rotation loop and the opacity fade — the indicator is simply shown
 * while `isRefreshing` is true and hidden otherwise. Translating the
 * gesture itself still moves the indicator with the finger (that is
 * functional, not decorative), consistent with how the other gesture
 * hooks interpret Req 2.5 / Req 4.6.
 *
 * ─── Caller is responsible for ──────────────────────────────────────────────
 *
 * Task 9.20 / Req 9.4: this hook produces an `error: string | null`
 * field but does NOT render the error banner itself. Callers MUST mount
 * an `<AutoDismissBanner message={error} />` inside the scrollable
 * view root, otherwise sync failures are silently swallowed and the
 * user never sees Req 9.4's "3-second error banner" UX.
 *
 *     const { gesture, indicatorStyle, rotationStyle, error } =
 *         usePullToRefresh({ triggerDistance: 80, onSync, isSyncing });
 *
 *     return (
 *         <GestureDetector gesture={gesture}>
 *             <View>
 *                 <AutoDismissBanner message={error} />
 *                 <Animated.View style={[indicatorStyle, rotationStyle]}>
 *                     <SyncIcon />
 *                 </Animated.View>
 *                 {children}
 *             </View>
 *         </GestureDetector>
 *     );
 *
 * Task 18.2's EventCard / calendar-view wiring should include this
 * mount at the top of each scrollable view's layout.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 2.5
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import type { PanGesture } from 'react-native-gesture-handler';
import {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { AnimatedStyle } from 'react-native-reanimated';
import type { ViewStyle } from 'react-native';

import { useAnimation } from '../animation/animationEngine';
import { usePullToRefreshStyle } from '../animation/microInteractions';

// ─── Public types ────────────────────────────────────────────────────────────

/**
 * Configuration accepted by `usePullToRefresh`.
 *
 * `triggerDistance` is fixed at 80 per Req 9.1. `isSyncing` is the
 * caller's authoritative "is a sync currently running?" flag — typically
 * fed from the TanStack Query `isFetching` / `isPending` state or the
 * `SyncEngine` status store.
 */
export interface PullToRefreshConfig {
  /** Minimum pull distance to trigger (pixels). Fixed at 80 per Req 9.1. */
  triggerDistance: 80;
  /** Sync function — returns a promise that resolves on success / rejects on failure. */
  onSync: () => Promise<void>;
  /** Whether a sync is already in progress (caller-owned). */
  isSyncing: boolean;
}

export interface UsePullToRefreshReturn {
  /** Pan gesture to hand to a `<GestureDetector>`. */
  gesture: PanGesture;
  /**
   * Animated style carrying the pull-specific transforms only: the
   * vertical `translateY` that follows the finger during the pull and
   * the `opacity` fade tied to sync start / completion (Req 9.3).
   *
   * Task 9.13: rotation is NOT in this style — it comes from
   * `rotationStyle` below, which is sourced from the canonical
   * `usePullToRefreshStyle` in the Micro-Interaction System. Consumers
   * apply both styles as an array so the indicator composes pull
   * translation + fade + rotation in one place without this hook
   * duplicating the Micro-Interaction System's motion tuning.
   *
   *     <Animated.View style={[pullStyle, rotationStyle]}>…</Animated.View>
   */
  indicatorStyle: AnimatedStyle<ViewStyle>;
  /**
   * Rotation-only style sourced from `usePullToRefreshStyle` in the
   * Micro-Interaction System. Spins while `isRefreshing || isSyncing`,
   * settles to 0deg otherwise (Req 9.2, 9.3). Compose with
   * `indicatorStyle` on the rendered `<Animated.View>`:
   *
   *     const { indicatorStyle, rotationStyle } = usePullToRefresh(cfg);
   *     return <Animated.View style={[indicatorStyle, rotationStyle]}>…</Animated.View>;
   */
  rotationStyle: AnimatedStyle<ViewStyle>;
  /**
   * True while the `onSync` promise is pending. Separate from
   * `config.isSyncing` so consumers can distinguish "this hook's own
   * trigger is running" from "some external sync is running".
   */
  isRefreshing: boolean;
  /**
   * Error message from the most recent `onSync` rejection, or `null`
   * when no error is outstanding. Consumers typically feed this into
   * an `<AutoDismissBanner message={error} />` to satisfy Req 9.4.
   * Cleared automatically on the next successful sync.
   */
  error: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Trigger threshold (pixels). Fixed per Req 9.1. */
const TRIGGER_DISTANCE = 80;

/** Fade-out duration after a sync completes (ms). Req 9.3. */
const FADE_OUT_MS = 200;

/** Fade-in duration when the sync starts (matches fade-out for symmetry). */
const FADE_IN_MS = 200;

// Rotation period / settle are now owned by `usePullToRefreshStyle` in
// `src/ui/animation/microInteractions.ts` (Task 9.13 / Key Decision #2).
// If motion tuning changes there, this hook picks up the new values
// automatically.

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Pull-to-refresh gesture + indicator animation state.
 *
 * The returned `gesture` is always valid — even when `config.isSyncing`
 * is already true — so consumers can pass it unconditionally to a
 * `<GestureDetector>`. The sync-lock guards live inside the worklet so
 * the gesture is a no-op while a refresh is in flight.
 */
export function usePullToRefresh(
  config: PullToRefreshConfig,
): UsePullToRefreshReturn {
  const { shouldAnimate } = useAnimation();

  // JS-thread state.
  //
  // `isRefreshing` is authored by this hook (set true when we call
  // `onSync`, cleared when the promise settles). `error` captures the
  // rejection reason for the most recent sync failure — cleared when a
  // subsequent sync succeeds.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Task 9.13 / Key Decision #2: the rotation is owned by the canonical
  // `usePullToRefreshStyle` in the Micro-Interaction System. We pass it
  // `isRefreshing || config.isSyncing` so the spinner runs whenever a
  // sync is in flight — whether this hook fired it or some external
  // caller (e.g. a background sync) did. The returned style is exposed
  // verbatim as `rotationStyle` for consumers to compose with
  // `indicatorStyle`.
  const rotationStyle = usePullToRefreshStyle(
    isRefreshing || config.isSyncing,
  );

  // Shared values (UI thread).
  //
  // - `translationY`: raw vertical translation driven by the pan handler.
  //   Used to move the indicator with the finger during the pull.
  // - `opacity`: indicator opacity. Fades in on sync start, fades out
  //   200ms after sync completes.
  // - `isRefreshingShared`: mirror of the JS-side `isRefreshing` flag so
  //   the pan `.onEnd` worklet can short-circuit additional pulls
  //   without a JS bridge.
  // - `isSyncingExternalShared`: mirror of `config.isSyncing` for the
  //   same reason.
  const translationY = useSharedValue(0);
  const opacity = useSharedValue(0);
  const isRefreshingShared = useSharedValue(false);
  const isSyncingExternalShared = useSharedValue(config.isSyncing);

  // Keep the shared copies of the gating flags in lockstep with React
  // state. A plain `useEffect` that assigns the primitive JS value onto
  // the shared value is the right tool here — `useDerivedValue` is for
  // deriving a NEW shared value from other shared values, not for
  // pushing JS state down to the UI thread.
  useEffect(() => {
    isSyncingExternalShared.value = config.isSyncing;
  }, [config.isSyncing, isSyncingExternalShared]);

  useEffect(() => {
    isRefreshingShared.value = isRefreshing;
  }, [isRefreshing, isRefreshingShared]);

  // ── JS-thread callbacks ──────────────────────────────────────────────────

  /**
   * Invoked from the pan worklet once the release crosses the threshold.
   * Kicks off the sync promise, manages the `isRefreshing` / `error`
   * React state, and re-drives the animated indicator (rotation loop +
   * fade-in on start, fade-out + settle on completion).
   *
   * The function is idempotent: repeated calls while `isRefreshing` is
   * already `true` are ignored. That shouldn't happen (the worklet
   * guards on `isRefreshingShared`) but the defensive check keeps the
   * JS-side state machine consistent even if the gesture fires twice
   * back-to-back.
   */
  const startSync = useCallback(() => {
    // Double-check the sync-lock on the JS side. If the worklet fired
    // this in a race we still want the first-one-in to win.
    if (isRefreshing || config.isSyncing) return;

    setIsRefreshing(true);

    // Fade the indicator in. Rotation is driven separately by the
    // canonical `usePullToRefreshStyle` in the Micro-Interaction System
    // (Task 9.13) — it reacts to `isRefreshing || isSyncing` and starts
    // spinning on its own.
    opacity.value = withTiming(1, {
      duration: shouldAnimate ? FADE_IN_MS : 0,
      easing: Easing.out(Easing.cubic),
    });

    // Kick off the sync and wire up the completion path. We use the
    // returned promise so consumers that wrap this hook in an
    // AsyncBoundary-style abstraction still see rejections propagate.
    config
      .onSync()
      .then(() => {
        // Success clears any prior error message.
        setError(null);
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error
            ? err.message
            : typeof err === 'string'
              ? err
              : 'Sync failed';
        setError(message);
      })
      .finally(() => {
        // Regardless of outcome: fade the indicator out and settle the
        // pull translation back to rest so the next pull starts from a
        // clean state. The rotation spin-down is handled automatically
        // by `usePullToRefreshStyle` when `isRefreshing` flips false.
        if (shouldAnimate) {
          opacity.value = withTiming(0, {
            duration: FADE_OUT_MS,
            easing: Easing.out(Easing.cubic),
          });
          translationY.value = withSpring(0, {
            damping: 15,
            stiffness: 150,
            mass: 1,
          });
        } else {
          opacity.value = 0;
          translationY.value = 0;
        }
        setIsRefreshing(false);
      });
  }, [
    config,
    isRefreshing,
    opacity,
    shouldAnimate,
    translationY,
  ]);

  /**
   * Called from the pan worklet when the release does NOT cross the
   * threshold. All state changes happen inside the worklet (spring-back
   * of `translationY` to zero); this JS-side hook exists only so any
   * future non-animation side-effect (e.g. an analytics "pull abandoned"
   * log) has a stable place to live. Marking it as a defined callback
   * also lets us stabilise the gesture's `useMemo` dep list.
   */
  const springBackToRest = useCallback(() => {
    // Intentionally empty — see doc comment.
  }, []);

  // ── Gesture ──────────────────────────────────────────────────────────────

  const gesture = useMemo<PanGesture>(() => {
    return Gesture.Pan()
      .onUpdate((event) => {
        'worklet';
        // Ignore additional pulls while a sync is already in progress
        // (Req 9.5). We clamp the finger-tracked translation to a
        // non-negative value so upward pans never leave the indicator
        // stranded above its resting position.
        if (isRefreshingShared.value || isSyncingExternalShared.value) {
          return;
        }
        translationY.value = Math.max(0, event.translationY);
      })
      .onEnd((event) => {
        'worklet';
        // Sync-lock (Req 9.5) — both the hook-owned flag and the
        // caller-owned flag must be clear before we'll start a new sync.
        if (isRefreshingShared.value || isSyncingExternalShared.value) {
          // Even if we cannot trigger, return the indicator to rest so
          // the user doesn't see a stuck pull offset.
          translationY.value = withSpring(0, {
            damping: 15,
            stiffness: 150,
            mass: 1,
          });
          return;
        }

        if (event.translationY >= TRIGGER_DISTANCE) {
          runOnJS(startSync)();
        } else {
          // Didn't cross the threshold — spring back to rest.
          translationY.value = withSpring(0, {
            damping: 15,
            stiffness: 150,
            mass: 1,
          });
          runOnJS(springBackToRest)();
        }
      })
      .onFinalize(() => {
        'worklet';
        // Safety net for cancelled / interrupted gestures: if the pan
        // was torn down mid-drag (pointer up outside the tracked view,
        // external gesture takeover) we still want the indicator to
        // return to rest. Only act when we did NOT transition into the
        // syncing state — `startSync` owns the translation spring in
        // that case.
        if (!isRefreshingShared.value && !isSyncingExternalShared.value) {
          if (translationY.value !== 0) {
            translationY.value = withSpring(0, {
              damping: 15,
              stiffness: 150,
              mass: 1,
            });
          }
        }
      });
  }, [
    isRefreshingShared,
    isSyncingExternalShared,
    startSync,
    springBackToRest,
    translationY,
  ]);

  // ── Animated style ───────────────────────────────────────────────────────

  /**
   * Pull-specific animated style. Carries only the vertical translation
   * (finger-tracked pull) and opacity (sync-start/complete fade). The
   * rotation transform lives in `rotationStyle`, returned separately so
   * consumers can compose the two on the rendered `<Animated.View>`
   * (see `UsePullToRefreshReturn.indicatorStyle` docblock).
   */
  const indicatorStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      opacity: opacity.value,
      transform: [{ translateY: translationY.value }],
    };
  });

  return {
    gesture,
    indicatorStyle,
    rotationStyle,
    isRefreshing,
    error,
  };
}
