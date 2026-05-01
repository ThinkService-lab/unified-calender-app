/**
 * Haptic Feedback Engine.
 *
 * Thin wrapper around `expo-haptics` that exposes a synchronous
 * `trigger(pattern)` API and degrades to a no-op on platforms without
 * haptic support (web) or when the OS-level haptic setting is disabled.
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6
 *
 * Design notes:
 * - `trigger()` returns `void` even though the underlying expo-haptics
 *   calls are asynchronous. Call sites (gesture controllers, Quick
 *   Create Bar submissions) fire haptics from user-interaction paths
 *   where awaiting would add perceptible latency; we fire-and-forget
 *   the promise and swallow rejections so an OS-level "haptics
 *   disabled" setting silently skips the trigger instead of throwing
 *   (Req 14.5).
 * - The `success` pattern is implemented as two sequential Light
 *   impacts 100ms apart, NOT a single `NotificationFeedbackType.Success`
 *   (Req 14.3 mandates "two short light pulses"). The notification API
 *   produces a single vibration on iOS which does not match the spec's
 *   perceptible pattern.
 * - On web, `trigger()` is an immediate no-op — we do not even touch the
 *   `expo-haptics` module, so bundlers that tree-shake platform-specific
 *   code still strip the native-only dependency from web builds.
 */

import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HapticPattern = 'light' | 'medium' | 'heavy' | 'selection' | 'success';

export interface HapticFeedbackEngine {
  /**
   * Trigger a haptic pattern. No-op on web or when the OS-level haptic
   * setting is disabled. Safe to call from user-interaction paths —
   * never throws, never awaits.
   */
  trigger(pattern: HapticPattern): void;

  /**
   * Whether haptic feedback is reachable on this platform. Web always
   * reports `false`; iOS and Android report `true` regardless of the
   * user's OS-level setting (there is no stable way to query that
   * setting at runtime — disabled haptics simply no-op at the
   * expo-haptics layer).
   */
  readonly isAvailable: boolean;
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** Gap between the two Light impacts that make up the `success` pattern. */
const SUCCESS_PULSE_GAP_MS = 100;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a {@link HapticFeedbackEngine}. The returned engine is stateless —
 * multiple calls to `createHapticEngine()` produce functionally identical
 * instances. Exported primarily so non-React callers (sync engines,
 * background workers) have access without pulling in the React hook.
 */
export function createHapticEngine(): HapticFeedbackEngine {
  const isWeb = Platform.OS === 'web';
  const isAvailable = !isWeb;

  const trigger = (pattern: HapticPattern): void => {
    if (isWeb) return;

    // Promise returns from expo-haptics are intentionally discarded.
    // Any rejection (e.g. OS haptics disabled) is swallowed by the
    // .catch below so the UI thread never sees an unhandled promise.
    switch (pattern) {
      case 'light':
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(noop);
        return;
      case 'medium':
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(noop);
        return;
      case 'heavy':
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(noop);
        return;
      case 'selection':
        void Haptics.selectionAsync().catch(noop);
        return;
      case 'success':
        // Two sequential Light impacts 100ms apart — per Req 14.3 and
        // design Key Decision notes. We schedule the second impact
        // with setTimeout rather than awaiting so the caller remains
        // synchronous.
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(noop);
        setTimeout(() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(noop);
        }, SUCCESS_PULSE_GAP_MS);
        return;
      default:
        // Exhaustiveness check — surfaces a type error if a new pattern
        // is added without a case here.
        assertNever(pattern);
    }
  };

  return {
    trigger,
    isAvailable,
  };
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

/**
 * Shared module-level engine instance. The engine is stateless, so every
 * component gets the same instance and no re-creation happens across
 * renders. This is identical to calling `createHapticEngine()` at every
 * hook call but avoids the allocation.
 */
const sharedEngine: HapticFeedbackEngine = createHapticEngine();

/**
 * React hook for haptic feedback. Returns a stable reference to the
 * shared engine so callers can safely include `haptics` in effect
 * dependency arrays without triggering re-runs.
 */
export function useHaptics(): HapticFeedbackEngine {
  return sharedEngine;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function noop(): void {
  // Intentionally empty — swallows expo-haptics rejections when the OS
  // haptic setting is off (Req 14.5).
}

function assertNever(x: never): never {
  throw new Error(`Unhandled haptic pattern: ${String(x)}`);
}
