/**
 * Accessibility utilities barrel exports.
 * Requirements: 9.6
 */

// Accessible label builders
export {
  buildEventAccessibilityLabel,
  buildDayCellAccessibilityLabel,
  buildViewChangeAnnouncement,
  buildSyncStatusAnnouncement,
  buildConflictAlertAnnouncement,
  formatTimeForAccessibility,
} from './accessibilityUtils';

// React hooks for accessibility
export {
  useScreenReaderAnnouncement,
  useReducedMotion,
  useFocusTrap,
  useKeyboardNavigation,
} from './useAccessibility';

// WCAG contrast ratio utilities
export {
  getContrastRatio,
  meetsAAContrast,
  meetsAALargeContrast,
  parseHexColor,
  getRelativeLuminance,
  validatePaletteContrast,
  type ContrastReport,
} from './colorContrast';

// Calendar patterns for color-blind users
export {
  CALENDAR_PATTERNS,
  getCalendarPattern,
  getCalendarPatternIcon,
  buildAccountPatternMap,
  type CalendarPattern,
  type CalendarPatternId,
} from './calendarPatterns';

// Keyboard navigation
export {
  KEYBOARD_KEYS,
  createCalendarKeyHandler,
  isKeyboardNavigationSupported,
  type KeyboardNavigationConfig,
} from './keyboardNavigation';
