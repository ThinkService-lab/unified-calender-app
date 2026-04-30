/**
 * Unit tests for `useAnimatedEventDelete` — the hook that gates actual
 * event deletion behind the `eventDeleted` shrink+fade animation.
 *
 * Test strategy:
 *   The hook depends on:
 *     - `useEventsStore` selectors for `markPendingAnimatedDelete` and
 *       `clearPendingAnimatedDelete`
 *     - `useReducedMotion()` from useAccessibility
 *     - A `crudService` with `deleteEvent(eventId)` passed via config
 *
 *   All are mocked. We test the `deleteWithAnimation` callback logic
 *   by extracting the core flow and verifying:
 *     1. markPendingAnimatedDelete is called first
 *     2. A 250ms delay occurs (0ms under reduced motion)
 *     3. crudService.deleteEvent is called
 *     4. clearPendingAnimatedDelete is called on success
 *     5. clearPendingAnimatedDelete is called on failure (revert)
 *     6. onDeleteError is called on failure
 *
 * Requirements: 7.3, 7.5
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockMarkPending = jest.fn();
const mockClearPending = jest.fn();

jest.mock('../../../stores/eventsStore', () => ({
  useEventsStore: (selector: (s: Record<string, unknown>) => unknown) => {
    const fakeState = {
      markPendingAnimatedDelete: mockMarkPending,
      clearPendingAnimatedDelete: mockClearPending,
    };
    return selector(fakeState);
  },
}));

let mockReducedMotion = false;
jest.mock('../../accessibility/useAccessibility', () => ({
  useReducedMotion: () => mockReducedMotion,
}));

// React hooks mock — useCallback just returns the function directly
// in our test environment since we're calling the hook as a plain function.
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useCallback: (fn: Function) => fn,
}));

import { useAnimatedEventDelete } from '../useAnimatedEventDelete';
import type { UseAnimatedEventDeleteConfig } from '../useAnimatedEventDelete';

// ─── Test helpers ────────────────────────────────────────────────────────────

function createMockCrudService(
  result: { success: boolean; error?: string } = { success: true },
  shouldReject = false,
) {
  return {
    deleteEvent: jest.fn().mockImplementation(() => {
      if (shouldReject) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve(result);
    }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useAnimatedEventDelete — deleteWithAnimation flow', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockReducedMotion = false;
    mockMarkPending.mockClear();
    mockClearPending.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('calls markPendingAnimatedDelete(eventId) first', async () => {
    const crudService = createMockCrudService();
    const { deleteWithAnimation } = useAnimatedEventDelete({ crudService });

    const promise = deleteWithAnimation('evt-1');

    // markPendingAnimatedDelete should be called synchronously
    expect(mockMarkPending).toHaveBeenCalledWith('evt-1');
    expect(mockMarkPending).toHaveBeenCalledTimes(1);

    // crudService.deleteEvent should NOT have been called yet (waiting for timer)
    expect(crudService.deleteEvent).not.toHaveBeenCalled();

    // Advance past the 250ms animation delay
    jest.advanceTimersByTime(250);
    await promise;
  });

  test('waits 250ms before calling crudService.deleteEvent(eventId)', async () => {
    const crudService = createMockCrudService();
    const { deleteWithAnimation } = useAnimatedEventDelete({ crudService });

    const promise = deleteWithAnimation('evt-1');

    // At 249ms — deleteEvent should not have been called
    jest.advanceTimersByTime(249);
    expect(crudService.deleteEvent).not.toHaveBeenCalled();

    // At 250ms — deleteEvent should be called
    jest.advanceTimersByTime(1);
    await promise;
    expect(crudService.deleteEvent).toHaveBeenCalledWith('evt-1');
    expect(crudService.deleteEvent).toHaveBeenCalledTimes(1);
  });

  test('on success calls clearPendingAnimatedDelete(eventId) to prevent memory leak', async () => {
    const crudService = createMockCrudService({ success: true });
    const { deleteWithAnimation } = useAnimatedEventDelete({ crudService });

    const promise = deleteWithAnimation('evt-1');
    jest.advanceTimersByTime(250);
    await promise;

    // Task 2.7 step 4: clearPendingAnimatedDelete MUST be called on
    // success so the pendingAnimatedDelete set does not grow unbounded
    // across long-running sessions with many deletes.
    expect(mockClearPending).toHaveBeenCalledWith('evt-1');
    expect(mockClearPending).toHaveBeenCalledTimes(1);
  });

  test('on failure (crudService.deleteEvent rejects) calls clearPendingAnimatedDelete(eventId) to revert', async () => {
    const crudService = createMockCrudService(
      { success: true },
      /* shouldReject= */ true,
    );
    const onDeleteError = jest.fn();
    const { deleteWithAnimation } = useAnimatedEventDelete({
      crudService,
      onDeleteError,
    });

    const promise = deleteWithAnimation('evt-1');
    jest.advanceTimersByTime(250);
    await promise;

    // clearPendingAnimatedDelete should be called to revert the visual state
    expect(mockClearPending).toHaveBeenCalledWith('evt-1');
    expect(mockClearPending).toHaveBeenCalledTimes(1);
  });

  test('on failure (crudService.deleteEvent rejects) calls onDeleteError', async () => {
    const crudService = createMockCrudService(
      { success: true },
      /* shouldReject= */ true,
    );
    const onDeleteError = jest.fn();
    const { deleteWithAnimation } = useAnimatedEventDelete({
      crudService,
      onDeleteError,
    });

    const promise = deleteWithAnimation('evt-1');
    jest.advanceTimersByTime(250);
    await promise;

    expect(onDeleteError).toHaveBeenCalledWith('evt-1', 'Network error');
  });

  test('on failure (crudService.deleteEvent returns {success: false}) calls clearPendingAnimatedDelete and onDeleteError', async () => {
    const crudService = createMockCrudService({
      success: false,
      error: 'Event not found',
    });
    const onDeleteError = jest.fn();
    const { deleteWithAnimation } = useAnimatedEventDelete({
      crudService,
      onDeleteError,
    });

    const promise = deleteWithAnimation('evt-1');
    jest.advanceTimersByTime(250);
    await promise;

    // clearPendingAnimatedDelete called to revert
    expect(mockClearPending).toHaveBeenCalledWith('evt-1');

    // onDeleteError called with the error message
    expect(onDeleteError).toHaveBeenCalledWith('evt-1', 'Event not found');
  });

  test('on failure without onDeleteError callback, does not throw', async () => {
    const crudService = createMockCrudService({
      success: false,
      error: 'Something went wrong',
    });
    // No onDeleteError provided
    const { deleteWithAnimation } = useAnimatedEventDelete({ crudService });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const promise = deleteWithAnimation('evt-1');
    jest.advanceTimersByTime(250);
    await promise;

    // Should not throw — falls back to console.error
    expect(mockClearPending).toHaveBeenCalledWith('evt-1');
    consoleSpy.mockRestore();
  });
});

describe('useAnimatedEventDelete — reduced motion degradation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockReducedMotion = true;
    mockMarkPending.mockClear();
    mockClearPending.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('uses 0ms delay when reduced motion is active', async () => {
    const crudService = createMockCrudService();
    const { deleteWithAnimation } = useAnimatedEventDelete({ crudService });

    const promise = deleteWithAnimation('evt-1');

    // markPendingAnimatedDelete should still be called
    expect(mockMarkPending).toHaveBeenCalledWith('evt-1');

    // With reduced motion, the delay is 0ms, so we need to advance
    // the timer by 0ms (the setTimeout(resolve, 0) still needs a tick)
    jest.advanceTimersByTime(0);
    await promise;

    // crudService.deleteEvent should have been called immediately
    expect(crudService.deleteEvent).toHaveBeenCalledWith('evt-1');
  });

  test('does not wait 250ms when reduced motion is active', async () => {
    const crudService = createMockCrudService();
    const { deleteWithAnimation } = useAnimatedEventDelete({ crudService });

    // Start the delete
    const promise = deleteWithAnimation('evt-1');

    // Advance just 1ms — should already have called deleteEvent
    // because reduced motion uses 0ms delay
    jest.advanceTimersByTime(1);
    await promise;

    expect(crudService.deleteEvent).toHaveBeenCalledWith('evt-1');
  });
});
