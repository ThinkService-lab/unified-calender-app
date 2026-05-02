/**
 * gestureAvailability — runtime detection of `react-native-gesture-handler`.
 *
 * Provides a cached, module-level check for whether the gesture handler
 * native module is available at runtime. Components that depend on
 * gesture-handler features (drag-to-reschedule, drag-to-resize, swipe
 * navigation) read this flag to decide whether to render gesture-driven
 * interactions or fall back to `TouchableOpacity`-based alternatives.
 *
 * Detection runs once at module load time and caches the result. The
 * `useGestureAvailability()` hook is intentionally lightweight — no
 * `useState`, no `useEffect`, just a read of the cached value — so it
 * adds zero overhead per render.
 *
 * Requirements: 4.1, 13.1, 15.1
 */

import { useMemo } from 'react';

// ─── Public types ────────────────────────────────────────────────────────────

export interface GestureAvailability {
  /** Whether `react-native-gesture-handler` is available at runtime. */
  isGestureHandlerAvailable: boolean;
  /** Whether drag-based features (reschedule, resize) should be enabled. */
  isDragEnabled: boolean;
  /** Whether swipe navigation should be enabled. */
  isSwipeEnabled: boolean;
}

// ─── Module-level detection ──────────────────────────────────────────────────

/**
 * Detect whether `react-native-gesture-handler` is usable at runtime.
 *
 * The library is a declared dependency so the static `import` resolves at
 * bundle time. However, the native module may not be linked (e.g., in a
 * plain Jest environment without the native bridge, or in a misconfigured
 * Expo build). We probe by accessing the `Gesture` factory — if the
 * import resolved but the native module is missing, accessing `Gesture`
 * typically throws a "NativeModule is null" error.
 *
 * The detection is wrapped in a try/catch so a missing native module
 * never surfaces as an uncaught error.
 */
function detectGestureHandler(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const gestureHandler = require('react-native-gesture-handler');
    // Accessing `Gesture` exercises the native bridge. If the native
    // module is not linked, this access (or the require above) throws.
    return typeof gestureHandler?.Gesture !== 'undefined';
  } catch {
    return false;
  }
}

/** Cached result — computed once at module load time. */
let _cachedAvailability: boolean | null = null;

function getCachedAvailability(): boolean {
  if (_cachedAvailability === null) {
    _cachedAvailability = detectGestureHandler();
  }
  return _cachedAvailability;
}

// ─── Plain function (non-React contexts) ─────────────────────────────────────

/**
 * Returns whether `react-native-gesture-handler` is available at runtime.
 *
 * Safe to call from non-React contexts (store initializers, utility
 * modules, test setup). The result is cached after the first call.
 */
export function isGestureHandlerAvailable(): boolean {
  return getCachedAvailability();
}

// ─── React hook ──────────────────────────────────────────────────────────────

/**
 * Hook that returns the current gesture availability state.
 *
 * Lightweight by design: reads a module-level cached boolean and returns
 * a stable object via `useMemo`. No `useState`, no `useEffect`, no
 * subscriptions — the availability of a native module does not change
 * during the lifetime of a running app, so there is nothing to observe.
 *
 * When `isGestureHandlerAvailable` is `false`:
 *   - `isDragEnabled` = false → components fall back to `TouchableOpacity`
 *   - `isSwipeEnabled` = false → swipe navigation is disabled
 *
 * When `isGestureHandlerAvailable` is `true`:
 *   - `isDragEnabled` = true
 *   - `isSwipeEnabled` = true
 */
export function useGestureAvailability(): GestureAvailability {
  const available = getCachedAvailability();

  return useMemo<GestureAvailability>(
    () => ({
      isGestureHandlerAvailable: available,
      isDragEnabled: available,
      isSwipeEnabled: available,
    }),
    [available],
  );
}

// ─── Test utilities ──────────────────────────────────────────────────────────

/**
 * Reset the cached availability value. **Test-only** — allows tests to
 * exercise both the available and unavailable code paths without
 * reloading the module.
 *
 * @internal
 */
export function _resetCachedAvailability(): void {
  _cachedAvailability = null;
}

/**
 * Override the cached availability value. **Test-only** — allows tests
 * to force a specific availability state without depending on the actual
 * native module resolution.
 *
 * @internal
 */
export function _overrideCachedAvailability(value: boolean): void {
  _cachedAvailability = value;
}
