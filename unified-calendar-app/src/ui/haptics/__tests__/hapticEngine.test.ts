/**
 * Unit tests for the Haptic Feedback Engine.
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6
 *
 * Test strategy:
 * - Mock `expo-haptics` so we can observe which API calls the engine
 *   makes for each pattern without triggering real device haptics.
 * - Mock `react-native` Platform so we can toggle between 'web' (no-op
 *   path) and 'ios' (native path) without needing a device.
 * - Always test via `createHapticEngine()` (not `useHaptics()`) so each
 *   test gets a fresh engine that picks up the current mocked Platform.
 *   `useHaptics()` returns a module-level singleton captured at import
 *   time, which would pin the platform to whatever was mocked first.
 */

// The react-native mock must be declared with jest.mock before any import
// of the engine, so the engine's transitive import of Platform resolves
// to the mocked module.
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: {
    Light: 'Light',
    Medium: 'Medium',
    Heavy: 'Heavy',
    Rigid: 'Rigid',
    Soft: 'Soft',
  },
  NotificationFeedbackType: {
    Success: 'Success',
    Warning: 'Warning',
    Error: 'Error',
  },
}));

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { createHapticEngine } from '../hapticEngine';

describe('Haptic Feedback Engine', () => {
  const mockImpact = Haptics.impactAsync as jest.MockedFunction<typeof Haptics.impactAsync>;
  const mockSelection = Haptics.selectionAsync as jest.MockedFunction<
    typeof Haptics.selectionAsync
  >;
  const mockNotification = Haptics.notificationAsync as jest.MockedFunction<
    typeof Haptics.notificationAsync
  >;

  // The Platform mock is mutable so individual tests can flip between
  // 'ios' and 'web'. Each test resets it in beforeEach to match the
  // default (ios) unless it explicitly overrides.
  const setPlatform = (os: string): void => {
    (Platform as unknown as { OS: string }).OS = os;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    setPlatform('ios');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('pattern → expo-haptics API mapping', () => {
    it('maps "light" to impactAsync(Light)', () => {
      const engine = createHapticEngine();
      engine.trigger('light');
      expect(mockImpact).toHaveBeenCalledTimes(1);
      expect(mockImpact).toHaveBeenCalledWith('Light');
    });

    it('maps "medium" to impactAsync(Medium)', () => {
      const engine = createHapticEngine();
      engine.trigger('medium');
      expect(mockImpact).toHaveBeenCalledTimes(1);
      expect(mockImpact).toHaveBeenCalledWith('Medium');
    });

    it('maps "heavy" to impactAsync(Heavy)', () => {
      const engine = createHapticEngine();
      engine.trigger('heavy');
      expect(mockImpact).toHaveBeenCalledTimes(1);
      expect(mockImpact).toHaveBeenCalledWith('Heavy');
    });

    it('maps "selection" to selectionAsync()', () => {
      const engine = createHapticEngine();
      engine.trigger('selection');
      expect(mockSelection).toHaveBeenCalledTimes(1);
      expect(mockImpact).not.toHaveBeenCalled();
    });
  });

  describe('"success" pattern — two Light impacts with 100ms gap', () => {
    it('fires the first Light impact immediately', () => {
      const engine = createHapticEngine();
      engine.trigger('success');

      expect(mockImpact).toHaveBeenCalledTimes(1);
      expect(mockImpact).toHaveBeenNthCalledWith(1, 'Light');
    });

    it('fires the second Light impact after 100ms', () => {
      const engine = createHapticEngine();
      engine.trigger('success');

      // Advance less than 100ms — second impact should not yet have fired.
      jest.advanceTimersByTime(99);
      expect(mockImpact).toHaveBeenCalledTimes(1);

      // Cross the 100ms threshold — second impact fires.
      jest.advanceTimersByTime(1);
      expect(mockImpact).toHaveBeenCalledTimes(2);
      expect(mockImpact).toHaveBeenNthCalledWith(2, 'Light');
    });

    it('uses two impactAsync(Light) calls, NOT notificationAsync(Success)', () => {
      // Req 14.3 specifies "two short light pulses". Using
      // NotificationFeedbackType.Success would produce a single
      // notification vibration on iOS which does not match the
      // user-perceived pattern. This test guards against regression.
      const engine = createHapticEngine();
      engine.trigger('success');
      jest.advanceTimersByTime(100);

      expect(mockNotification).not.toHaveBeenCalled();
      expect(mockImpact).toHaveBeenCalledTimes(2);
      expect(mockImpact).toHaveBeenNthCalledWith(1, 'Light');
      expect(mockImpact).toHaveBeenNthCalledWith(2, 'Light');
    });
  });

  describe('web platform — no-op behaviour', () => {
    it('does not call any expo-haptics API for light/medium/heavy', () => {
      setPlatform('web');
      const engine = createHapticEngine();

      engine.trigger('light');
      engine.trigger('medium');
      engine.trigger('heavy');

      expect(mockImpact).not.toHaveBeenCalled();
    });

    it('does not call selectionAsync on web', () => {
      setPlatform('web');
      const engine = createHapticEngine();

      engine.trigger('selection');

      expect(mockSelection).not.toHaveBeenCalled();
    });

    it('does not schedule any impact for success on web (no pending timers)', () => {
      setPlatform('web');
      const engine = createHapticEngine();

      engine.trigger('success');
      // Advance enough time that the 100ms timer would have fired if
      // the web branch had incorrectly scheduled it.
      jest.advanceTimersByTime(1000);

      expect(mockImpact).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('reports isAvailable === false on web', () => {
      setPlatform('web');
      const engine = createHapticEngine();
      expect(engine.isAvailable).toBe(false);
    });

    it('reports isAvailable === true on iOS', () => {
      setPlatform('ios');
      const engine = createHapticEngine();
      expect(engine.isAvailable).toBe(true);
    });

    it('reports isAvailable === true on Android', () => {
      setPlatform('android');
      const engine = createHapticEngine();
      expect(engine.isAvailable).toBe(true);
    });
  });

  describe('OS haptics disabled — silent failure', () => {
    it('swallows a rejected impactAsync without throwing', async () => {
      // Simulate the "OS haptics disabled" case: expo-haptics rejects
      // with some error. The engine must not re-throw.
      mockImpact.mockRejectedValueOnce(new Error('haptics disabled'));

      const engine = createHapticEngine();

      // Calling .trigger() itself is sync and must not throw.
      expect(() => engine.trigger('light')).not.toThrow();

      // Let the rejected promise microtask settle — if the engine did
      // not attach a .catch handler we would see an unhandled
      // rejection here. jest surfaces unhandled rejections as test
      // failures so passing this line is the assertion.
      await Promise.resolve();
      await Promise.resolve();
    });

    it('swallows a rejected selectionAsync without throwing', async () => {
      mockSelection.mockRejectedValueOnce(new Error('haptics disabled'));

      const engine = createHapticEngine();
      expect(() => engine.trigger('selection')).not.toThrow();

      await Promise.resolve();
      await Promise.resolve();
    });

    it('swallows rejections from BOTH impacts in the success pattern', async () => {
      mockImpact
        .mockRejectedValueOnce(new Error('disabled'))
        .mockRejectedValueOnce(new Error('disabled'));

      const engine = createHapticEngine();
      expect(() => engine.trigger('success')).not.toThrow();

      // Drive the 100ms gap, then let the second rejection settle.
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();

      expect(mockImpact).toHaveBeenCalledTimes(2);
    });
  });

  describe('exhaustiveness', () => {
    it('throws for an unknown pattern (type system should prevent reaching this in practice)', () => {
      const engine = createHapticEngine();
      // Deliberately bypass the HapticPattern type to exercise the
      // `assertNever` branch. This documents that an unexpected
      // pattern is a hard error, not a silent no-op — so new patterns
      // added to the union require a case here.
      expect(() => (engine.trigger as (p: string) => void)('bogus')).toThrow(
        /Unhandled haptic pattern/,
      );
    });
  });
});
