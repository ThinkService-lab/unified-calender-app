/**
 * Tests for gesture context store (vanilla).
 * Requirements: 15.6
 */

import {
  gestureContextStore,
  type ActiveGesture,
} from '../gestureContextStore';

describe('GestureContextStore', () => {
  beforeEach(() => {
    gestureContextStore.getState().clearActiveGesture();
  });

  test('starts with no active gesture and drag inactive', () => {
    expect(gestureContextStore.getState().activeGesture).toBeNull();
    expect(gestureContextStore.getState().isDragActive).toBe(false);
  });

  test('setActiveGesture(reschedule) marks drag active', () => {
    gestureContextStore.getState().setActiveGesture('reschedule');

    expect(gestureContextStore.getState().activeGesture).toBe('reschedule');
    expect(gestureContextStore.getState().isDragActive).toBe(true);
  });

  test('setActiveGesture(resize) marks drag active', () => {
    gestureContextStore.getState().setActiveGesture('resize');

    expect(gestureContextStore.getState().activeGesture).toBe('resize');
    expect(gestureContextStore.getState().isDragActive).toBe(true);
  });

  test('setActiveGesture(swipe) does not mark drag active', () => {
    gestureContextStore.getState().setActiveGesture('swipe');

    expect(gestureContextStore.getState().activeGesture).toBe('swipe');
    expect(gestureContextStore.getState().isDragActive).toBe(false);
  });

  test('setActiveGesture(pull-to-refresh) does not mark drag active', () => {
    gestureContextStore.getState().setActiveGesture('pull-to-refresh');

    expect(gestureContextStore.getState().activeGesture).toBe('pull-to-refresh');
    expect(gestureContextStore.getState().isDragActive).toBe(false);
  });

  test('setActiveGesture(null) clears the active gesture', () => {
    gestureContextStore.getState().setActiveGesture('reschedule');
    gestureContextStore.getState().setActiveGesture(null);

    expect(gestureContextStore.getState().activeGesture).toBeNull();
    expect(gestureContextStore.getState().isDragActive).toBe(false);
  });

  test('clearActiveGesture resets to null and drag inactive', () => {
    gestureContextStore.getState().setActiveGesture('resize');
    expect(gestureContextStore.getState().isDragActive).toBe(true);

    gestureContextStore.getState().clearActiveGesture();

    expect(gestureContextStore.getState().activeGesture).toBeNull();
    expect(gestureContextStore.getState().isDragActive).toBe(false);
  });

  test('switching between drag gestures keeps isDragActive true', () => {
    gestureContextStore.getState().setActiveGesture('reschedule');
    gestureContextStore.getState().setActiveGesture('resize');

    expect(gestureContextStore.getState().activeGesture).toBe('resize');
    expect(gestureContextStore.getState().isDragActive).toBe(true);
  });

  test('switching from drag to swipe flips isDragActive off', () => {
    gestureContextStore.getState().setActiveGesture('reschedule');
    expect(gestureContextStore.getState().isDragActive).toBe(true);

    gestureContextStore.getState().setActiveGesture('swipe');
    expect(gestureContextStore.getState().isDragActive).toBe(false);
  });

  test('subscribe notifies listeners on gesture changes', () => {
    const gestures: ActiveGesture[] = [];
    const unsubscribe = gestureContextStore.subscribe((state) => {
      gestures.push(state.activeGesture);
    });

    gestureContextStore.getState().setActiveGesture('reschedule');
    gestureContextStore.getState().setActiveGesture('swipe');
    gestureContextStore.getState().clearActiveGesture();

    unsubscribe();

    expect(gestures).toEqual(['reschedule', 'swipe', null]);
  });

  test('isDragActive is true only for reschedule and resize (invariant)', () => {
    const cases: Array<{ gesture: ActiveGesture; expected: boolean }> = [
      { gesture: 'reschedule', expected: true },
      { gesture: 'resize', expected: true },
      { gesture: 'swipe', expected: false },
      { gesture: 'pull-to-refresh', expected: false },
      { gesture: null, expected: false },
    ];

    for (const { gesture, expected } of cases) {
      gestureContextStore.getState().setActiveGesture(gesture);
      expect(gestureContextStore.getState().isDragActive).toBe(expected);
    }
  });
});
