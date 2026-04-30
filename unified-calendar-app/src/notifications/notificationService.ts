/**
 * NotificationService — manages push notification registration, permissions,
 * delivery, and privacy-aware content filtering.
 *
 * This service is the single entry point for sending push notifications.
 * It ensures that:
 * - Permissions are requested during onboarding or on first trigger (Req 15.1)
 * - Notifications are sent for conflicts, sync issues, payment, re-auth (Req 15.2)
 * - Platform-specific handlers are used (APNs/FCM/Web Push) (Req 15.3)
 * - Per-category preferences are respected (Req 15.4)
 * - Background push reception works on mobile (Req 15.5)
 * - Sensitive event details are suppressed unless opted in (Req 15.6)
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6
 */

import type {
  PlatformNotificationHandler,
  NotificationCategory,
  NotificationPayload,
  NotificationPermissionStatus,
  PushToken,
  NotificationPreferences,
} from './types';

/** Dependencies injected into the NotificationService */
export interface NotificationServiceDeps {
  /** Platform-specific notification handler (iOS/Android/Web) */
  platformHandler: PlatformNotificationHandler;
  /** Get current notification preferences */
  getPreferences: () => NotificationPreferences;
  /** Update the permission status in the store */
  setPermissionStatus: (status: NotificationPermissionStatus) => void;
}

export interface NotificationService {
  /**
   * Request notification permissions from the user (Req 15.1).
   * Called during onboarding or on first relevant trigger.
   */
  requestPermissions(): Promise<NotificationPermissionStatus>;

  /**
   * Get the current permission status.
   */
  getPermissionStatus(): Promise<NotificationPermissionStatus>;

  /**
   * Register for push notifications and return the device token.
   * Returns null if permissions are not granted.
   */
  registerForPush(): Promise<PushToken | null>;

  /**
   * Send a notification for a detected conflict (Req 15.2).
   * Suppresses sensitive details unless user opted in (Req 15.6).
   */
  notifyConflict(eventTitle: string, conflictingEventTitle: string): Promise<boolean>;

  /**
   * Send a notification for a sync conflict requiring resolution (Req 15.2).
   */
  notifySyncConflict(accountName: string): Promise<boolean>;

  /**
   * Send a notification for a subscription payment issue (Req 15.2).
   */
  notifyPaymentIssue(daysRemaining: number): Promise<boolean>;

  /**
   * Send a notification for a calendar account re-authentication need (Req 15.2).
   */
  notifyReauthRequired(accountName: string): Promise<boolean>;

  /**
   * Send a generic notification for a given category.
   * Respects per-category preferences and privacy settings.
   */
  sendNotification(payload: NotificationPayload): Promise<boolean>;

  /**
   * Send a notification for a calendar event reminder (Req 15.2).
   * Suppresses sensitive details unless user opted in (Req 15.6).
   */
  notifyReminder(eventTitle: string, minutesBefore: number): Promise<boolean>;

  /**
   * Schedule a reminder notification to be delivered at a future time.
   * Uses the platform handler's scheduled notification API.
   */
  scheduleReminder(eventTitle: string, eventId: string, triggerAt: Date): Promise<boolean>;

  /**
   * Set up background notification reception (Req 15.5).
   */
  setupBackgroundHandler(
    onNotification: (payload: NotificationPayload) => void
  ): void;

  /**
   * Clean up resources.
   */
  teardown(): void;
}

let notificationIdCounter = 0;

/** Generates a unique notification ID */
export function generateNotificationId(): string {
  notificationIdCounter += 1;
  return `notif-${Date.now()}-${notificationIdCounter}`;
}

/** Reset the ID counter (for testing) */
export function resetNotificationIdCounter(): void {
  notificationIdCounter = 0;
}

/**
 * Builds a privacy-aware notification payload.
 * Suppresses sensitive event details (titles, attendees) unless the user
 * has explicitly opted in via showSensitiveDetails (Req 15.6).
 */
export function buildPrivacyAwarePayload(
  category: NotificationCategory,
  title: string,
  body: string,
  showSensitiveDetails: boolean,
  data?: Record<string, string>
): NotificationPayload {
  return {
    id: generateNotificationId(),
    category,
    title: showSensitiveDetails ? title : sanitizeTitle(title, category),
    body: showSensitiveDetails ? body : sanitizeBody(body, category),
    data,
  };
}

/**
 * Sanitizes a notification title by removing sensitive event details.
 * When sensitive details are suppressed, generic category-based titles are used.
 */
function sanitizeTitle(
  _title: string,
  category: NotificationCategory
): string {
  const categoryTitles: Record<NotificationCategory, string> = {
    conflicts: 'Schedule Conflict Detected',
    reminders: 'Calendar Reminder',
    sync_status: 'Sync Update',
    payment: 'Subscription Notice',
  };
  return categoryTitles[category];
}

/**
 * Sanitizes a notification body by removing sensitive event details.
 * When sensitive details are suppressed, generic messages are used.
 */
function sanitizeBody(
  _body: string,
  category: NotificationCategory
): string {
  const categoryBodies: Record<NotificationCategory, string> = {
    conflicts: 'You have overlapping events. Tap to review.',
    reminders: 'You have an upcoming event. Tap to view.',
    sync_status: 'A sync issue needs your attention.',
    payment: 'There is an issue with your subscription.',
  };
  return categoryBodies[category];
}

/**
 * Creates a NotificationService instance.
 */
export function createNotificationService(
  deps: NotificationServiceDeps
): NotificationService {
  const { platformHandler, getPreferences, setPermissionStatus } = deps;

  /**
   * Check if a notification should be sent for a given category.
   * Returns false if notifications are globally disabled, OS permission
   * is not granted, or the specific category is disabled (Req 15.4).
   */
  async function shouldSendForCategory(
    category: NotificationCategory
  ): Promise<boolean> {
    const prefs = getPreferences();
    if (!prefs.enabled) return false;
    if (!prefs.categories[category]) return false;

    const permStatus = await platformHandler.getPermissionStatus();
    return permStatus === 'granted';
  }

  return {
    async requestPermissions(): Promise<NotificationPermissionStatus> {
      const status = await platformHandler.requestPermissions();
      setPermissionStatus(status);
      return status;
    },

    async getPermissionStatus(): Promise<NotificationPermissionStatus> {
      const status = await platformHandler.getPermissionStatus();
      setPermissionStatus(status);
      return status;
    },

    async registerForPush(): Promise<PushToken | null> {
      const permStatus = await platformHandler.getPermissionStatus();
      if (permStatus !== 'granted') return null;
      return platformHandler.registerForPushNotifications();
    },

    async notifyConflict(
      eventTitle: string,
      conflictingEventTitle: string
    ): Promise<boolean> {
      if (!(await shouldSendForCategory('conflicts'))) return false;

      const prefs = getPreferences();
      const title = `Conflict: ${eventTitle} and ${conflictingEventTitle}`;
      const body = `"${eventTitle}" overlaps with "${conflictingEventTitle}". Tap to review and resolve.`;

      const payload = buildPrivacyAwarePayload(
        'conflicts',
        title,
        body,
        prefs.showSensitiveDetails,
        { type: 'conflict' }
      );

      await platformHandler.displayNotification(payload);
      return true;
    },

    async notifySyncConflict(accountName: string): Promise<boolean> {
      if (!(await shouldSendForCategory('sync_status'))) return false;

      const prefs = getPreferences();
      const title = `Sync conflict on ${accountName}`;
      const body = `A sync conflict on ${accountName} needs your attention. Tap to resolve.`;

      const payload = buildPrivacyAwarePayload(
        'sync_status',
        title,
        body,
        prefs.showSensitiveDetails,
        { type: 'sync_conflict' }
      );

      await platformHandler.displayNotification(payload);
      return true;
    },

    async notifyPaymentIssue(daysRemaining: number): Promise<boolean> {
      if (!(await shouldSendForCategory('payment'))) return false;

      const prefs = getPreferences();
      const dayText = daysRemaining === 1 ? '1 day' : `${daysRemaining} days`;
      const title = 'Subscription payment issue';
      const body = `There's an issue with your payment. You have ${dayText} to update your payment method before features are restricted.`;

      const payload = buildPrivacyAwarePayload(
        'payment',
        title,
        body,
        prefs.showSensitiveDetails,
        { type: 'payment_issue', daysRemaining: String(daysRemaining) }
      );

      await platformHandler.displayNotification(payload);
      return true;
    },

    async notifyReauthRequired(accountName: string): Promise<boolean> {
      if (!(await shouldSendForCategory('sync_status'))) return false;

      const prefs = getPreferences();
      const title = `${accountName} needs to be reconnected`;
      const body = `Your connection to ${accountName} has expired. Tap to reconnect.`;

      const payload = buildPrivacyAwarePayload(
        'sync_status',
        title,
        body,
        prefs.showSensitiveDetails,
        { type: 'reauth_required' }
      );

      await platformHandler.displayNotification(payload);
      return true;
    },

    async sendNotification(payload: NotificationPayload): Promise<boolean> {
      if (!(await shouldSendForCategory(payload.category))) return false;

      const prefs = getPreferences();
      const privacyPayload = buildPrivacyAwarePayload(
        payload.category,
        payload.title,
        payload.body,
        prefs.showSensitiveDetails,
        payload.data
      );

      await platformHandler.displayNotification(privacyPayload);
      return true;
    },

    async notifyReminder(eventTitle: string, minutesBefore: number): Promise<boolean> {
      if (!(await shouldSendForCategory('reminders'))) return false;

      const prefs = getPreferences();
      const title = `Reminder: ${eventTitle} in ${minutesBefore} minutes`;
      const body = `"${eventTitle}" starts in ${minutesBefore} minutes.`;

      const payload = buildPrivacyAwarePayload(
        'reminders',
        title,
        body,
        prefs.showSensitiveDetails,
        { type: 'reminder', minutesBefore: String(minutesBefore) }
      );

      await platformHandler.displayNotification(payload);
      return true;
    },

    async scheduleReminder(eventTitle: string, eventId: string, triggerAt: Date): Promise<boolean> {
      if (!(await shouldSendForCategory('reminders'))) return false;

      const prefs = getPreferences();
      const title = `Reminder: ${eventTitle}`;
      const body = `"${eventTitle}" is starting soon.`;

      const payload = buildPrivacyAwarePayload(
        'reminders',
        title,
        body,
        prefs.showSensitiveDetails,
        { type: 'scheduled_reminder', eventId }
      );

      await platformHandler.scheduleNotification(payload, triggerAt);
      return true;
    },

    setupBackgroundHandler(
      onNotification: (payload: NotificationPayload) => void
    ): void {
      platformHandler.setupBackgroundHandler(onNotification);
    },

    teardown(): void {
      platformHandler.teardown();
    },
  };
}
