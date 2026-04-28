/**
 * Configure TanStack Query's onlineManager for offline-aware behavior.
 * When offline, queries pause fetching and mutations are deferred.
 * Requirements: 4.1, 4.2
 */

import { onlineManager } from '@tanstack/react-query';

/**
 * Sets up the online manager to track network connectivity.
 * Uses the browser/RN NetInfo events when available,
 * falling back to navigator.onLine.
 */
export function configureOnlineManager(): void {
  // Default behavior uses navigator.onLine + online/offline events,
  // which works for both web and React Native (via polyfills).
  // If a custom listener is needed (e.g., @react-native-community/netinfo),
  // call onlineManager.setEventListener to override.

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    onlineManager.setEventListener((setOnline) => {
      const onOnline = () => setOnline(true);
      const onOffline = () => setOnline(false);

      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);

      return () => {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      };
    });
  }
}

/**
 * Manually set the online status (useful for testing or native NetInfo integration).
 */
export function setOnlineStatus(isOnline: boolean): void {
  onlineManager.setOnline(isOnline);
}

/**
 * Check current online status.
 */
export function getOnlineStatus(): boolean {
  return onlineManager.isOnline();
}
