/**
 * Tests for keyboard navigation key mappings.
 * Requirements: 9.6
 */

import { Platform } from 'react-native';
import {
  createCalendarKeyHandler,
  KEYBOARD_KEYS,
  isKeyboardNavigationSupported,
} from '../keyboardNavigation';

// Mock Platform.OS for web tests
jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

function createMockKeyEvent(key: string): KeyboardEvent {
  return {
    key,
    preventDefault: jest.fn(),
  } as unknown as KeyboardEvent;
}

describe('KEYBOARD_KEYS', () => {
  it('defines all expected key constants', () => {
    expect(KEYBOARD_KEYS.ARROW_LEFT).toBe('ArrowLeft');
    expect(KEYBOARD_KEYS.ARROW_RIGHT).toBe('ArrowRight');
    expect(KEYBOARD_KEYS.ARROW_UP).toBe('ArrowUp');
    expect(KEYBOARD_KEYS.ARROW_DOWN).toBe('ArrowDown');
    expect(KEYBOARD_KEYS.ENTER).toBe('Enter');
    expect(KEYBOARD_KEYS.SPACE).toBe(' ');
    expect(KEYBOARD_KEYS.ESCAPE).toBe('Escape');
    expect(KEYBOARD_KEYS.TAB).toBe('Tab');
    expect(KEYBOARD_KEYS.HOME).toBe('Home');
    expect(KEYBOARD_KEYS.END).toBe('End');
    expect(KEYBOARD_KEYS.PAGE_UP).toBe('PageUp');
    expect(KEYBOARD_KEYS.PAGE_DOWN).toBe('PageDown');
  });
});

describe('createCalendarKeyHandler', () => {
  it('calls onPreviousDay for ArrowLeft', () => {
    const onPreviousDay = jest.fn();
    const handler = createCalendarKeyHandler({ onPreviousDay });
    const event = createMockKeyEvent('ArrowLeft');

    handler(event);

    expect(onPreviousDay).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('calls onNextDay for ArrowRight', () => {
    const onNextDay = jest.fn();
    const handler = createCalendarKeyHandler({ onNextDay });
    const event = createMockKeyEvent('ArrowRight');

    handler(event);

    expect(onNextDay).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('calls onPreviousWeek for ArrowUp', () => {
    const onPreviousWeek = jest.fn();
    const handler = createCalendarKeyHandler({ onPreviousWeek });
    const event = createMockKeyEvent('ArrowUp');

    handler(event);

    expect(onPreviousWeek).toHaveBeenCalledTimes(1);
  });

  it('calls onNextWeek for ArrowDown', () => {
    const onNextWeek = jest.fn();
    const handler = createCalendarKeyHandler({ onNextWeek });
    const event = createMockKeyEvent('ArrowDown');

    handler(event);

    expect(onNextWeek).toHaveBeenCalledTimes(1);
  });

  it('calls onSelect for Enter', () => {
    const onSelect = jest.fn();
    const handler = createCalendarKeyHandler({ onSelect });
    const event = createMockKeyEvent('Enter');

    handler(event);

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('calls onSelect for Space', () => {
    const onSelect = jest.fn();
    const handler = createCalendarKeyHandler({ onSelect });
    const event = createMockKeyEvent(' ');

    handler(event);

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss for Escape', () => {
    const onDismiss = jest.fn();
    const handler = createCalendarKeyHandler({ onDismiss });
    const event = createMockKeyEvent('Escape');

    handler(event);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls onStartOfWeek for Home', () => {
    const onStartOfWeek = jest.fn();
    const handler = createCalendarKeyHandler({ onStartOfWeek });
    const event = createMockKeyEvent('Home');

    handler(event);

    expect(onStartOfWeek).toHaveBeenCalledTimes(1);
  });

  it('calls onEndOfWeek for End', () => {
    const onEndOfWeek = jest.fn();
    const handler = createCalendarKeyHandler({ onEndOfWeek });
    const event = createMockKeyEvent('End');

    handler(event);

    expect(onEndOfWeek).toHaveBeenCalledTimes(1);
  });

  it('calls onPreviousMonth for PageUp', () => {
    const onPreviousMonth = jest.fn();
    const handler = createCalendarKeyHandler({ onPreviousMonth });
    const event = createMockKeyEvent('PageUp');

    handler(event);

    expect(onPreviousMonth).toHaveBeenCalledTimes(1);
  });

  it('calls onNextMonth for PageDown', () => {
    const onNextMonth = jest.fn();
    const handler = createCalendarKeyHandler({ onNextMonth });
    const event = createMockKeyEvent('PageDown');

    handler(event);

    expect(onNextMonth).toHaveBeenCalledTimes(1);
  });

  it('does not call callbacks for unrecognized keys', () => {
    const onSelect = jest.fn();
    const onDismiss = jest.fn();
    const handler = createCalendarKeyHandler({ onSelect, onDismiss });
    const event = createMockKeyEvent('a');

    handler(event);

    expect(onSelect).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('handles missing callbacks gracefully', () => {
    const handler = createCalendarKeyHandler({});
    const event = createMockKeyEvent('ArrowLeft');

    // Should not throw
    expect(() => handler(event)).not.toThrow();
  });
});

describe('isKeyboardNavigationSupported', () => {
  it('returns true on web', () => {
    expect(isKeyboardNavigationSupported()).toBe(true);
  });
});
