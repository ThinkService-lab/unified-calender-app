/**
 * Android push notification handler using FCM via expo-notifications.
 * Requirements: 15.1, 15.3, 15.5
 *
 * This module handles:
 * - Requesting notification permissions on Android
 * - Registering for FCM push tokens
 * - Displaying local notifications with notification channels
 * - Background push notification reception
 */

import type {
  PlatformNotificationHandler,
  NotificationPermissionStatus,
  PushToken,
  NotificationPayload,
} from './types';

/**
 * Dependencies for the Android notification handler.
 * Injected for testability — avoids direct dependency on expo-notifications.
 */
export interface AndroidNotificationHandlerDeps {
  requestPermissions: () => Promise<{ status: string }>;
  getPermissionStatus: () => Promise<{ status: string }>;
  getDevicePushToken: () => Promise<{ data: string }>;
  scheduleNotification: (content: {
    title: string;
    body: string;
    data?: Record<string, string>;
    channelId?: string;
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
  setNotificationChannel?: (channelId: string, config: {
    name: string;
    importance: number;
  }) => Promise<void>;
}

/** Android notification channel IDs matching notification categories */
export const ANDROID_CHANNELS = {
  conflicts: { id: 'conflicts', name: 'Conflicts', importance: 4 },
  reminders: { id: 'reminders', name: 'Reminders', importance: 4 },
  sync_status: { id: 'sync_status', name: 'Sync Status', importance: 2 },
  payment: { id: 'payment', name: 'Payment', importance: 4 },
} as const;

function mapPermissionStatus(status: string): NotificationPermissionStatus {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

/**
 * Creates an Android notification handler backed by FCM.
 */
export function createAndroidNotificationHandler(
  deps: AndroidNotificationHandlerDeps
): PlatformNotificationHandler {
  let listenerSubscription: { remove: () => void } | null = null;

  async function setupChannels(): Promise<void> {
    if (!deps.setNotificationChannel) return;
    for (const channel of Object.values(ANDROID_CHANNELS)) {
      await deps.setNotificationChannel(channel.id, {
        name: channel.name,
        importance: channel.importance,
      });
    }
  }

  return {
    async requestPermissions(): Promise<NotificationPermissionStatus> {
      const result = await deps.requestPermissions();
      // Set up notification channels after permission is granted
      if (result.status === 'granted') {
        await setupChannels();
      }
      return mapPermissionStatus(result.status);
    },

    async getPermissionStatus(): Promise<NotificationPermissionStatus> {
      const result = await deps.getPermissionStatus();
      return mapPermissionStatus(result.status);
    },

    async registerForPushNotifications(): Promise<PushToken | null> {
      try {
        const tokenData = await deps.getDevicePushToken();
        return { token: tokenData.data, platform: 'android' };
      } catch {
        return null;
      }
    },

    async displayNotification(payload: NotificationPayload): Promise<void> {
      await deps.scheduleNotification({
        title: payload.title,
        body: payload.body,
        data: payload.data,
        channelId: payload.category,
      });
    },

    async scheduleNotification(payload: NotificationPayload, triggerAt: Date): Promise<void> {
      await deps.scheduleNotification({
        title: payload.title,
        body: payload.body,
        data: payload.data,
        channelId: payload.category,
        trigger: { date: triggerAt },
      });
    },

    setupBackgroundHandler(
      onNotification: (payload: NotificationPayload) => void
    ): void {
      deps.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });

      // Listen for received notifications (background push via FCM, Req 15.5)
      listenerSubscription = deps.addNotificationReceivedListener(
        (notification) => {
          const data = notification.request.content.data;
          if (data && data.category) {
            onNotification({
              id: data.id ?? `android-${Date.now()}`,
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
