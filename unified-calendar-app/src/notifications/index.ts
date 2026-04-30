/**
 * Push notification module re-exports.
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6
 */

// Types
export type {
  NotificationCategory,
  NotificationPermissionStatus,
  PushToken,
  NotificationPreferences,
  NotificationPayload,
  PlatformNotificationHandler,
} from './types';
export {
  ALL_NOTIFICATION_CATEGORIES,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from './types';

// Notification preferences store
export {
  useNotificationPreferencesStore,
  createNotificationPreferencesStore,
  useNotificationEnabled,
  useNotificationPermissionStatus,
  useShowSensitiveDetails,
  useNotificationSummary,
} from './notificationPreferencesStore';
export type { NotificationPreferencesState } from './notificationPreferencesStore';

// Notification service
export {
  createNotificationService,
  buildPrivacyAwarePayload,
  generateNotificationId,
  resetNotificationIdCounter,
} from './notificationService';
export type {
  NotificationService,
  NotificationServiceDeps,
} from './notificationService';
