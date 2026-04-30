/**
 * Push notification types for the Unified Calendar App.
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6
 */

/** Notification categories that users can configure preferences for (Req 15.4) */
export type NotificationCategory =
  | 'conflicts'
  | 'reminders'
  | 'sync_status'
  | 'payment';

/** All notification categories as an array for iteration */
export const ALL_NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  'conflicts',
  'reminders',
  'sync_status',
  'payment',
] as const;

/** Permission status for push notifications */
export type NotificationPermissionStatus =
  | 'granted'
  | 'denied'
  | 'undetermined';

/** Platform-specific push token */
export interface PushToken {
  token: string;
  platform: 'ios' | 'android' | 'web';
}

/** Per-category notification preferences (Req 15.4) */
export interface NotificationPreferences {
  /** Whether push notifications are enabled globally */
  enabled: boolean;
  /** Per-category enable/disable */
  categories: Record<NotificationCategory, boolean>;
  /** Whether sensitive event details (titles, attendees) are included in notifications (Req 15.6) */
  showSensitiveDetails: boolean;
}

/** Default notification preferences — all categories enabled, sensitive details hidden */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: true,
  categories: {
    conflicts: true,
    reminders: true,
    sync_status: true,
    payment: true,
  },
  showSensitiveDetails: false,
};

/** Payload for a push notification to be displayed */
export interface NotificationPayload {
  /** Unique notification ID */
  id: string;
  /** Notification category for filtering */
  category: NotificationCategory;
  /** Title shown in the notification */
  title: string;
  /** Body text shown in the notification */
  body: string;
  /** Optional data payload for deep linking */
  data?: Record<string, string>;
}

/**
 * Platform-specific notification handler interface.
 * Each platform (iOS/Android/Web) implements this to handle
 * APNs, FCM, and Web Push API respectively (Req 15.3).
 */
export interface PlatformNotificationHandler {
  /** Request notification permissions from the user (Req 15.1) */
  requestPermissions(): Promise<NotificationPermissionStatus>;
  /** Get the current permission status */
  getPermissionStatus(): Promise<NotificationPermissionStatus>;
  /** Register for push notifications and return the device token */
  registerForPushNotifications(): Promise<PushToken | null>;
  /** Display a local notification */
  displayNotification(payload: NotificationPayload): Promise<void>;
  /** Schedule a notification to be displayed at a future time */
  scheduleNotification(payload: NotificationPayload, triggerAt: Date): Promise<void>;
  /** Set up background notification reception (Req 15.5) */
  setupBackgroundHandler(
    onNotification: (payload: NotificationPayload) => void
  ): void;
  /** Clean up resources */
  teardown(): void;
}
