/**
 * iOS push notification handler using APNs via expo-notifications.
 * Requirements: 15.1, 15.3, 15.5
 *
 * This module handles:
 * - Requesting notification permissions on iOS
 * - Registering for APNs push tokens
 * - Displaying local notifications
 * - Background push notification reception
 */

import type {
  PlatformNotificationHandler,
  NotificationPermissionStatus,
  PushToken,
  NotificationPayload,
} from './types';

/**
 * Dependencies for the iOS notification handler.
 * Injected for testability — avoids direct dependency on expo-notifications.
 */
export interface IOSNotificationHandlerDeps {
  requestPermissions: () => Promise<{ status: string }>;
  getPermissionStatus: () => Promise<{ status: string }>;
  getDevicePushToken: () => Promise<{ data: string }>;
  scheduleNotification: (content: {
    title: string;
    body: string;
    data?: Record<string, string>;
    trigger?: { date: Date };
  }) => Promise<string>;
  setNotificationHandler: (handler: {
    handleNotification: () => Promise<{
      shouldShowAlert: boolean;
      shouldPlaySound: boolean;
      shouldSetBadge: boolean;
    }>;
  }) => void;
  addNotificationReceivedListener: (
    callback: (notification: { request: { content: { data: Record<string, string> } } }) => void
  ) => { remove: () => void };
}

function mapPermissionStatus(status: string): NotificationPermissionStatus {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

/**
 * Creates an iOS notification handler backed by APNs.
 */
export function createIOSNotificationHandler(
  deps: IOSNotificationHandlerDeps
): PlatformNotificationHandler {
  let listenerSubscription: { remove: () => void } | null = null;

  return {
    async requestPermissions(): Promise<NotificationPermissionStatus> {
      const result = await deps.requestPermissions();
      return mapPermissionStatus(result.status);
    },

    async getPermissionStatus(): Promise<NotificationPermissionStatus> {
      const result = await deps.getPermissionStatus();
      return mapPermissionStatus(result.status);
    },

    async registerForPushNotifications(): Promise<PushToken | null> {
      try {
        const tokenData = await deps.getDevicePushToken();
        return { token: tokenData.data, platform: 'ios' };
      } catch {
        return null;
      }
    },

    async displayNotification(payload: NotificationPayload): Promise<void> {
      await deps.scheduleNotification({
        title: payload.title,
        body: payload.body,
        data: payload.data,
      });
    },

    async scheduleNotification(payload: NotificationPayload, triggerAt: Date): Promise<void> {
      await deps.scheduleNotification({
        title: payload.title,
        body: payload.body,
        data: payload.data,
        trigger: { date: triggerAt },
      });
    },

    setupBackgroundHandler(
      onNotification: (payload: NotificationPayload) => void
    ): void {
      // Set up the notification handler for foreground/background display
      deps.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
        }),
      });

      // Listen for received notifications (background push, Req 15.5)
      listenerSubscription = deps.addNotificationReceivedListener(
        (notification) => {
          const data = notification.request.content.data;
          if (data && data.category) {
            onNotification({
              id: data.id ?? `ios-${Date.now()}`,
              category: data.category as NotificationPayload['category'],
              title: data.title ?? '',
              body: data.body ?? '',
              data,
            });
          }
        }
      );
    },

    teardown(): void {
      listenerSubscription?.remove();
      listenerSubscription = null;
    },
  };
}
