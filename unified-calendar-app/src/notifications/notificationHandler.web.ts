/**
 * Web push notification handler using the Web Push API.
 * Requirements: 15.1, 15.3, 15.5
 *
 * This module handles:
 * - Requesting notification permissions via the Notification API
 * - Registering for Web Push via service worker
 * - Displaying notifications via the Notification constructor
 * - Background push via service worker (Req 15.5 — limited on web)
 */

import type {
  PlatformNotificationHandler,
  NotificationPermissionStatus,
  PushToken,
  NotificationPayload,
} from './types';

/**
 * Dependencies for the Web notification handler.
 * Injected for testability — avoids direct dependency on browser APIs.
 */
export interface WebNotificationHandlerDeps {
  /** Request notification permission (wraps Notification.requestPermission) */
  requestPermission: () => Promise<NotificationPermission>;
  /** Get current permission (wraps Notification.permission) */
  getPermission: () => NotificationPermission;
  /** Get the service worker registration for push subscription */
  getServiceWorkerRegistration: () => Promise<ServiceWorkerRegistration | null>;
  /** VAPID public key for push subscription */
  vapidPublicKey?: string;
  /** Show a notification (wraps new Notification() or registration.showNotification) */
  showNotification: (title: string, options: NotificationOptions) => void;
}

function mapWebPermission(
  permission: NotificationPermission
): NotificationPermissionStatus {
  if (permission === 'granted') return 'granted';
  if (permission === 'denied') return 'denied';
  return 'undetermined';
}

/**
 * Converts a base64 VAPID key to a Uint8Array for the push subscription.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Creates a Web notification handler backed by the Web Push API.
 */
export function createWebNotificationHandler(
  deps: WebNotificationHandlerDeps
): PlatformNotificationHandler {
  return {
    async requestPermissions(): Promise<NotificationPermissionStatus> {
      const result = await deps.requestPermission();
      return mapWebPermission(result);
    },

    async getPermissionStatus(): Promise<NotificationPermissionStatus> {
      const permission = deps.getPermission();
      return mapWebPermission(permission);
    },

    async registerForPushNotifications(): Promise<PushToken | null> {
      try {
        const registration = await deps.getServiceWorkerRegistration();
        if (!registration) return null;

        const subscribeOptions: PushSubscriptionOptionsInit = {
          userVisibleOnly: true,
        };

        if (deps.vapidPublicKey) {
          subscribeOptions.applicationServerKey = urlBase64ToUint8Array(
            deps.vapidPublicKey
          );
        }

        const subscription =
          await registration.pushManager.subscribe(subscribeOptions);
        const endpoint = subscription.endpoint;

        return { token: endpoint, platform: 'web' };
      } catch {
        return null;
      }
    },

    async displayNotification(payload: NotificationPayload): Promise<void> {
      deps.showNotification(payload.title, {
        body: payload.body,
        tag: payload.category,
        data: payload.data,
      });
    },

    async scheduleNotification(payload: NotificationPayload, triggerAt: Date): Promise<void> {
      const delay = triggerAt.getTime() - Date.now();
      if (delay <= 0) {
        // Trigger immediately if the time has already passed
        deps.showNotification(payload.title, {
          body: payload.body,
          tag: payload.category,
          data: payload.data,
        });
        return;
      }
      setTimeout(() => {
        deps.showNotification(payload.title, {
          body: payload.body,
          tag: payload.category,
          data: payload.data,
        });
      }, delay);
    },

    setupBackgroundHandler(
      _onNotification: (payload: NotificationPayload) => void
    ): void {
      // Web Push background handling is managed by the service worker.
      // The service worker receives push events and displays notifications
      // even when the page is not active. This is configured at the
      // service worker level, not in the main thread.
      // No-op here — the service worker handles background push.
    },

    teardown(): void {
      // No persistent listeners to clean up on web
    },
  };
}
