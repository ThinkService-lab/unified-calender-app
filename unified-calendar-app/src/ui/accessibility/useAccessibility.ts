/**
 * React hooks for accessibility features:
 * - Screen reader announcements
 * - Reduced motion preference
 * - Focus management (focus trapping in modals)
 * - Keyboard navigation
 * Requirements: 9.6
 */

import { useEffect, useCallback, useRef } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import {
  createCalendarKeyHandler,
  type KeyboardNavigationConfig,
} from './keyboardNavigation';

/**
 * Hook for making screen reader announcements.
 * Uses AccessibilityInfo.announceForAccessibility on native,
 * and aria-live regions on web.
 *
 * Returns an `announce` function that can be called imperatively.
 */
export function useScreenReaderAnnouncement() {
  const announce = useCallback(
    (message: string, priority: 'polite' | 'assertive' = 'polite') => {
      if (Platform.OS === 'web') {
        // On web, create a temporary aria-live region
        announceForWeb(message, priority);
      } else {
        // On native, use AccessibilityInfo
        AccessibilityInfo.announceForAccessibility(message);
      }
    },
    []
  );

  return { announce };
}

/**
 * Web-specific screen reader announcement using aria-live regions.
 */
function announceForWeb(message: string, priority: 'polite' | 'assertive'): void {
  if (typeof document === 'undefined') return;

  // Reuse or create the announcement container
  let container = document.getElementById('sr-announcements');
  if (!container) {
    container = document.createElement('div');
    container.id = 'sr-announcements';
    container.setAttribute('aria-live', priority);
    container.setAttribute('aria-atomic', 'true');
    container.setAttribute('role', 'status');
    Object.assign(container.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0, 0, 0, 0)',
      whiteSpace: 'nowrap',
      border: '0',
    });
    document.body.appendChild(container);
  }

  // Update the priority if needed
  container.setAttribute('aria-live', priority);

  // Clear and set the message (the clear + set triggers the announcement)
  container.textContent = '';
  // Use requestAnimationFrame to ensure the DOM update is processed
  requestAnimationFrame(() => {
    container!.textContent = message;
  });
}

/**
 * Hook that checks the user's prefers-reduced-motion setting.
 * Returns true if the user prefers reduced motion.
 *
 * On native: uses AccessibilityInfo.isReduceMotionEnabled
 * On web: uses the prefers-reduced-motion media query
 */
export function useReducedMotion(): boolean {
  const reducedMotionRef = useRef(false);

  // Check on mount
  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.matchMedia) {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        reducedMotionRef.current = mq.matches;

        const handler = (e: MediaQueryListEvent) => {
          reducedMotionRef.current = e.matches;
        };
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
      }
    } else {
      // React Native
      AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
        reducedMotionRef.current = enabled;
      });
    }
  }, []);

  return reducedMotionRef.current;
}

/**
 * Hook for trapping focus within a modal or dialog on web.
 * When active, Tab and Shift+Tab cycle through focusable elements
 * within the container ref, and focus is returned to the trigger
 * element on dismiss.
 *
 * @param containerRef - Ref to the modal/dialog container element
 * @param isActive - Whether the focus trap is currently active
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  isActive: boolean
) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || !isActive) return;
    if (typeof document === 'undefined') return;

    // Store the currently focused element to restore later
    previousFocusRef.current = document.activeElement as HTMLElement;

    const container = containerRef.current;
    if (!container) return;

    // Focus the first focusable element in the container
    const focusableSelector =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const focusableElements = container.querySelectorAll(focusableSelector);
    if (focusableElements.length > 0) {
      (focusableElements[0] as HTMLElement).focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusable = container.querySelectorAll(focusableSelector);
      if (focusable.length === 0) return;

      const firstFocusable = focusable[0] as HTMLElement;
      const lastFocusable = focusable[focusable.length - 1] as HTMLElement;

      if (event.shiftKey) {
        // Shift+Tab: if on first element, wrap to last
        if (document.activeElement === firstFocusable) {
          event.preventDefault();
          lastFocusable.focus();
        }
      } else {
        // Tab: if on last element, wrap to first
        if (document.activeElement === lastFocusable) {
          event.preventDefault();
          firstFocusable.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Return focus to the previously focused element
      if (previousFocusRef.current && previousFocusRef.current.focus) {
        previousFocusRef.current.focus();
      }
    };
  }, [containerRef, isActive]);
}

/**
 * Hook for keyboard navigation in calendar grids.
 * Attaches keyboard event listeners on web.
 *
 * @param config - Navigation callback configuration
 * @param isActive - Whether keyboard navigation is currently active
 */
export function useKeyboardNavigation(
  config: KeyboardNavigationConfig,
  isActive: boolean = true
) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !isActive) return;
    if (typeof document === 'undefined') return;

    const handler = createCalendarKeyHandler(config);
    document.addEventListener('keydown', handler as EventListener);

    return () => {
      document.removeEventListener('keydown', handler as EventListener);
    };
  }, [config, isActive]);
}
