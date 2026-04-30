/**
 * Property-based test for the Animation Engine's reduced-motion contract.
 *
 * **Property 3 (from the spec):** Reduced motion disables all animations.
 *
 *   For any animation configuration produced by the Animation Engine,
 *   when the `shouldAnimate` flag is `false` (Reduced_Motion_Mode
 *   active), the resulting animation SHALL resolve with duration 0
 *   (instant state change) rather than a spring or timing animation.
 *
 * Validates: Requirements 2.5, 3.4, 4.6, 7.5, 8.4, 13.6, 15.5, 16.6,
 *            19.7, 20.8 — all ten reduced-motion acceptance criteria
 *            across the competitive-ui-overhaul spec.
 *
 * Strategy:
 *   We mock `react-native-reanimated`'s `withSpring` and `withTiming`
 *   to capture the arguments passed by `withMotion`. The property
 *   check then generates random target values and spring-config
 *   overrides, calls `withMotion` with `shouldAnimate` both true and
 *   false, and asserts the invariants:
 *
 *     (a) shouldAnimate === false ⇒ the call delegates to `withTiming`
 *         with `{ duration: 0 }` and never to `withSpring`.
 *     (b) shouldAnimate === true  ⇒ the call delegates to `withSpring`
 *         with the shared SPRING_CONFIG (merged with any overrides)
 *         and never to `withTiming`.
 *
 * We also re-wire `useReducedMotion` to a controllable mock so we can
 * drive `shouldAnimate` from the outside. The mocks are reset between
 * each property run to keep the call log clean.
 *
 * Requirements: 2.5, 2.6
 */

import fc from 'fast-check';

// ─── Mocks ───────────────────────────────────────────────────────────────────

/** Call log populated by the reanimated mocks. Cleared before each run. */
const calls: Array<
  | { kind: 'spring'; toValue: number; config: Record<string, unknown> }
  | { kind: 'timing'; toValue: number; config: Record<string, unknown> }
> = [];

jest.mock('react-native-reanimated', () => ({
  withSpring: (toValue: number, config: Record<string, unknown>) => {
    calls.push({ kind: 'spring', toValue, config });
    // Return a sentinel object so consumers that inspect the result
    // can still tell the two call sites apart.
    return { __kind: 'spring', toValue, config };
  },
  withTiming: (toValue: number, config: Record<string, unknown>) => {
    calls.push({ kind: 'timing', toValue, config });
    return { __kind: 'timing', toValue, config };
  },
}));

/** Mock for `useReducedMotion` — the test controls its return value. */
let mockReducedMotion = false;
jest.mock('../../accessibility/useAccessibility', () => ({
  useReducedMotion: () => mockReducedMotion,
}));

// Import AFTER mocks are set up so `useAnimation` closes over the mocks.
// eslint-disable-next-line import/first
import { SPRING_CONFIG, useAnimation } from '../animationEngine';

// ─── Test utilities ──────────────────────────────────────────────────────────

/**
 * Invoke `withMotion` in a NON-worklet JS context. `withMotion` is
 * marked `'worklet'` in the source, but Reanimated's worklet directive
 * is a no-op in our mocked environment — the function runs as an
 * ordinary JS function and the mocks above observe its delegation.
 */
function invokeWithMotion(
  reducedMotion: boolean,
  toValue: number,
  config?: SpringConfigOverride,
): void {
  mockReducedMotion = reducedMotion;
  calls.length = 0;

  // `useAnimation` is a hook — exercise it inside a fake React dispatcher
  // by calling `React.useState` etc.? No — we only need the returned
  // `withMotion`, and `useAnimation` doesn't actually rely on React
  // dispatcher state (it just reads from `useReducedMotion`, which we
  // mocked). We can therefore call `useAnimation()` directly as a
  // plain function inside a `renderHook`-style wrapper:
  let returned!: ReturnType<typeof useAnimation>;

  // Minimal hook runner: we fake `useReducedMotion` above to return a
  // plain boolean, so `useAnimation` calls no other React hooks. It's
  // safe to call it directly.
  returned = useAnimation();

  returned.withMotion(toValue, config);
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Random finite numeric target value (scale, opacity, translateX, etc.). */
const arbToValue: fc.Arbitrary<number> = fc.double({
  min: -1000,
  max: 1000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Widened spring-config override shape (locally relaxed from the
 * `as const` shape on `SPRING_CONFIG` so `fc.double` generators can
 * produce plain `number` values without fighting the literal types). */
type SpringConfigOverride = {
  damping?: number;
  stiffness?: number;
  mass?: number;
};

/**
 * Random partial override of the shared spring config. May be undefined
 * (caller passes no override) or may specify any subset of spring params.
 */
const arbSpringConfigOverride: fc.Arbitrary<
  SpringConfigOverride | undefined
> = fc.option(
  fc.record(
    {
      damping: fc.double({ min: 1, max: 100, noNaN: true, noDefaultInfinity: true }),
      stiffness: fc.double({
        min: 1,
        max: 500,
        noNaN: true,
        noDefaultInfinity: true,
      }),
      mass: fc.double({ min: 0.1, max: 10, noNaN: true, noDefaultInfinity: true }),
    },
    { requiredKeys: [] },
  ),
  { nil: undefined },
);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Animation Engine — Property 3: reduced motion disables all animations', () => {
  // Feature: unified-calendar-app, Property 3: Reduced motion disables all animations
  test('withMotion resolves to withTiming({duration: 0}) when shouldAnimate is false', () => {
    fc.assert(
      fc.property(arbToValue, arbSpringConfigOverride, (toValue, override) => {
        invokeWithMotion(/* reducedMotion= */ true, toValue, override);

        // Exactly one call should have been made — the delegation to
        // withTiming for the instant path.
        expect(calls).toHaveLength(1);
        const call = calls[0];

        // Must be a withTiming call, not a withSpring call.
        expect(call.kind).toBe('timing');
        if (call.kind !== 'timing') return;

        // Duration MUST be exactly 0 — this is the reduced-motion contract.
        expect(call.config).toEqual({ duration: 0 });

        // The target value must be propagated unchanged so the shared
        // value snaps to it instantly.
        expect(call.toValue).toBe(toValue);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: unified-calendar-app, Property 3: Reduced motion disables all animations
  test('withMotion resolves to withSpring(SPRING_CONFIG ∪ override) when shouldAnimate is true', () => {
    fc.assert(
      fc.property(arbToValue, arbSpringConfigOverride, (toValue, override) => {
        invokeWithMotion(/* reducedMotion= */ false, toValue, override);

        expect(calls).toHaveLength(1);
        const call = calls[0];

        // Must be a withSpring call — never withTiming when motion is enabled.
        expect(call.kind).toBe('spring');
        if (call.kind !== 'spring') return;

        // Target propagated unchanged.
        expect(call.toValue).toBe(toValue);

        // Config is the shared SPRING_CONFIG merged with the override
        // (override wins on conflicting keys — the implementation uses
        // `{ ...SPRING_CONFIG, ...(config ?? {}) }`).
        const expected = { ...SPRING_CONFIG, ...(override ?? {}) };
        expect(call.config).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: unified-calendar-app, Property 3: Reduced motion disables all animations
  test('withMotion NEVER invokes withSpring when shouldAnimate is false', () => {
    // This is a separate assertion of the same invariant to make the
    // "no spring under reduced motion" contract explicit in the test
    // output — a failure here points directly at the reduced-motion
    // leak rather than at a generic "duration mismatch".
    fc.assert(
      fc.property(arbToValue, arbSpringConfigOverride, (toValue, override) => {
        invokeWithMotion(/* reducedMotion= */ true, toValue, override);

        const springCalls = calls.filter((c) => c.kind === 'spring');
        expect(springCalls).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });
});
