/**
 * Keyboard event handlers for web navigation in calendar views.
 * Provides arrow key navigation, Enter for selection, Escape for dismiss.
 * Requirements: 9.6
 */

import { Platform } from 'react-native';

/**
 * Key codes used for calendar keyboard navigation.
 */
export const KEYBOARD_KEYS = {
  ARROW_LEFT: 'ArrowLeft',
  ARROW_RIGHT: 'ArrowRight',
  ARROW_UP: 'ArrowUp',
  ARROW_DOWN: 'ArrowDown',
  ENTER: 'Enter',
  SPACE: ' ',
  ESCAPE: 'Escape',
  TAB: 'Tab',
  HOME: 'Home',
  END: 'End',
  PAGE_UP: 'PageUp',
  PAGE_DOWN: 'PageDown',
} as const;

/**
 * Configuration for keyboard navigation in a calendar grid.
 */
export interface KeyboardNavigationConfig {
  /** Navigate to previous day */
  onPreviousDay?: () => void;
  /** Navigate to next day */
  onNextDay?: () => void;
  /** Navigate to previous week */
  onPreviousWeek?: () => void;
  /** Navigate to next week */
  onNextWeek?: () => void;
  /** Select the currently focused date/event */
  onSelect?: () => void;
  /** Dismiss/close current view or modal */
  onDismiss?: () => void;
  /** Navigate to start of week */
  onStartOfWeek?: () => void;
  /** Navigate to end of week */
  onEndOfWeek?: () => void;
  /** Navigate to previous month */
  onPreviousMonth?: () => void;
  /** Navigate to next month */
  onNextMonth?: () => void;
}

/**
 * Creates a keyboard event handler for calendar grid navigation.
 * Only active on web platform.
 *
 * Key mappings:
 * - ArrowLeft: previous day
 * - ArrowRight: next day
 * - ArrowUp: previous week
 * - ArrowDown: next week
 * - Enter/Space: select
 * - Escape: dismiss
 * - Home: start of week
 * - End: end of week
 * - PageUp: previous month
 * - PageDown: next month
 */
export function createCalendarKeyHandler(
  config: KeyboardNavigationConfig
): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent) => {
    // Only handle on web
    if (Platform.OS !== 'web') return;

    switch (event.key) {
      case KEYBOARD_KEYS.ARROW_LEFT:
        event.preventDefault();
        config.onPreviousDay?.();
        break;
      case KEYBOARD_KEYS.ARROW_RIGHT:
        event.preventDefault();
        config.onNextDay?.();
        break;
      case KEYBOARD_KEYS.ARROW_UP:
        event.preventDefault();
        config.onPreviousWeek?.();
        break;
      case KEYBOARD_KEYS.ARROW_DOWN:
        event.preventDefault();
        config.onNextWeek?.();
        break;
      case KEYBOARD_KEYS.ENTER:
      case KEYBOARD_KEYS.SPACE:
        event.preventDefault();
        config.onSelect?.();
        break;
      case KEYBOARD_KEYS.ESCAPE:
        event.preventDefault();
        config.onDismiss?.();
        break;
      case KEYBOARD_KEYS.HOME:
        event.preventDefault();
        config.onStartOfWeek?.();
        break;
      case KEYBOARD_KEYS.END:
        event.preventDefault();
        config.onEndOfWeek?.();
        break;
      case KEYBOARD_KEYS.PAGE_UP:
        event.preventDefault();
        config.onPreviousMonth?.();
        break;
      case KEYBOARD_KEYS.PAGE_DOWN:
        event.preventDefault();
        config.onNextMonth?.();
        break;
    }
  };
}

/**
 * Returns true if the current platform supports keyboard navigation.
 */
export function isKeyboardNavigationSupported(): boolean {
  return Platform.OS === 'web';
}
