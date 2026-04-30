/**
 * Unit tests for NotificationService.
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6
 */

import {
  createNotificationService,
  buildPrivacyAwarePayload,
  resetNotificationIdCounter,
} from '../notificationService';
import type { NotificationServiceDeps } from '../notificationService';
import type {
  PlatformNotificationHandler,
  NotificationPreferences,
  NotificationPermissionStatus,
  NotificationPayload,
  PushToken,
} from '../types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../types';

/** Internal mock state that extends the handler interface */
interface MockPlatformHandler extends PlatformNotificationHandler {
  displayedNotifications: NotificationPayload[];
  scheduledNotifications: { payload: NotificationPayload; triggerAt: Date }[];
  backgroundCallback: ((payload: NotificationPayload) => void) | null;
  setMockPermissionStatus: (status: NotificationPermissionStatus) => void;
  setMockPushToken: (token: PushToken | null) => void;
}

/** Creates a mock platform handler with all methods as jest.fn() */
function createMockPlatformHandler(): MockPlatformHandler {
  let permissionStatus: NotificationPermissionStatus = 'granted';
  let pushToken: PushToken | null = { token: 'mock-token-123', platform: 'ios' };

  const mock: MockPlatformHandler = {
    displayedNotifications: [] as NotificationPayload[],
    scheduledNotifications: [] as { payload: NotificationPayload; triggerAt: Date }[],
    backgroundCallback: null as ((payload: NotificationPayload) => void) | null,

    setMockPermissionStatus(status: NotificationPermissionStatus) {
      permissionStatus = status;
    },
    setMockPushToken(token: PushToken | null) {
      pushToken = token;
    },

    requestPermissions: jest.fn(async (): Promise<NotificationPermissionStatus> => {
      return permissionStatus;
    }),
    getPermissionStatus: jest.fn(async (): Promise<NotificationPermissionStatus> => {
      return permissionStatus;
    }),
    registerForPushNotifications: jest.fn(async (): Promise<PushToken | null> => {
      return pushToken;
    }),
    displayNotification: jest.fn(async (payload: NotificationPayload): Promise<void> => {
      mock.displayedNotifications.push(payload);
    }),
    scheduleNotification: jest.fn(async (payload: NotificationPayload, triggerAt: Date): Promise<void> => {
      mock.scheduledNotifications.push({ payload, triggerAt });
    }),
    setupBackgroundHandler: jest.fn((
      onNotification: (payload: NotificationPayload) => void
    ): void => {
      mock.backgroundCallback = onNotification;
    }),
    teardown: jest.fn(),
  };
  return mock;
}

function createMockDeps(
  overrides?: Partial<{
    preferences: NotificationPreferences;
    permissionStatus: NotificationPermissionStatus;
  }>
): NotificationServiceDeps & {
  platformHandler: MockPlatformHandler;
  storedPermissionStatus: NotificationPermissionStatus | null;
  currentPreferences: NotificationPreferences;
} {
  const handler = createMockPlatformHandler();
  if (overrides?.permissionStatus) {
    handler.setMockPermissionStatus(overrides.permissionStatus);
  }

  const prefs: NotificationPreferences = overrides?.preferences ?? {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
  };

  const mock = {
    platformHandler: handler,
    storedPermissionStatus: null as NotificationPermissionStatus | null,
    currentPreferences: prefs,
    getPreferences: () => mock.currentPreferences,
    setPermissionStatus: (status: NotificationPermissionStatus) => {
      mock.storedPermissionStatus = status;
    },
  };
  return mock;
}

beforeEach(() => {
  resetNotificationIdCounter();
});

describe('NotificationService', () => {
  describe('requestPermissions (Req 15.1)', () => {
    it('requests permissions via the platform handler and updates the store', async () => {
      const deps = createMockDeps();
      const service = createNotificationService(deps);

      const status = await service.requestPermissions();

      expect(status).toBe('granted');
      expect(deps.platformHandler.requestPermissions).toHaveBeenCalled();
      expect(deps.storedPermissionStatus).toBe('granted');
    });

    it('returns denied when platform denies permission', async () => {
      const deps = createMockDeps({ permissionStatus: 'denied' });
      const service = createNotificationService(deps);

      const status = await service.requestPermissions();

      expect(status).toBe('denied');
      expect(deps.storedPermissionStatus).toBe('denied');
    });

    it('returns undetermined when permission is not yet decided', async () => {
      const deps = createMockDeps({ permissionStatus: 'undetermined' });
      const service = createNotificationService(deps);

      const status = await service.requestPermissions();

      expect(status).toBe('undetermined');
    });
  });

  describe('registerForPush', () => {
    it('returns a push token when permissions are granted', async () => {
      const deps = createMockDeps();
      const service = createNotificationService(deps);

      const token = await service.registerForPush();

      expect(token).toEqual({ token: 'mock-token-123', platform: 'ios' });
      expect(deps.platformHandler.registerForPushNotifications).toHaveBeenCalled();
    });

    it('returns null when permissions are not granted', async () => {
      const deps = createMockDeps({ permissionStatus: 'denied' });
      const service = createNotificationService(deps);

      const token = await service.registerForPush();

      expect(token).toBeNull();
      expect(deps.platformHandler.registerForPushNotifications).not.toHaveBeenCalled();
    });
  });

  describe('notifyConflict (Req 15.2)', () => {
    it('sends a conflict notification with event details when sensitive details are enabled', async () => {
      const deps = createMockDeps({
        preferences: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          showSensitiveDetails: true,
        },
      });
      const service = createNotificationService(deps);

      const sent = await service.notifyConflict('Team Standup', 'Dentist Appointment');

      expect(sent).toBe(true);
      expect(deps.platformHandler.displayedNotifications).toHaveLength(1);

      const notif = deps.platformHandler.displayedNotifications[0];
      expect(notif.category).toBe('conflicts');
      expect(notif.title).toContain('Team Standup');
      expect(notif.title).toContain('Dentist Appointment');
      expect(notif.body).toContain('Team Standup');
    });

    it('suppresses sensitive event details when showSensitiveDetails is false (Req 15.6)', async () => {
      const deps = createMockDeps({
        preferences: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          showSensitiveDetails: false,
        },
      });
      const service = createNotificationService(deps);

      const sent = await service.notifyConflict('Team Standup', 'Dentist Appointment');

      expect(sent).toBe(true);
      const notif = deps.platformHandler.displayedNotifications[0];
      expect(notif.title).not.toContain('Team Standup');
      expect(notif.title).not.toContain('Dentist Appointment');
      expect(notif.title).toBe('Schedule Conflict Detected');
      expect(notif.body).toContain('overlapping events');
    });

    it('does not send when conflicts category is disabled (Req 15.4)', async () => {
      const deps = createMockDeps({
        preferences: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          categories: {
            ...DEFAULT_NOTIFICATION_PREFERENCES.categories,
            conflicts: false,
          },
        },
      });
      const service = createNotificationService(deps);

      const sent = await service.notifyConflict('Event A', 'Event B');

      expect(sent).toBe(false);
      expect(deps.platformHandler.displayedNotifications).toHaveLength(0);
    });
  });

  describe('notifySyncConflict (Req 15.2)', () => {
    it('sends a sync conflict notification', async () => {
      const deps = createMockDeps({
        preferences: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          showSensitiveDetails: true,
        },
      });
      const service = createNotificationService(deps);

      const sent = await service.notifySyncConflict('Google Calendar');

      expect(sent).toBe(true);
      const notif = deps.platformHandler.displayedNotifications[0];
      expect(notif.category).toBe('sync_status');
      expect(notif.title).toContain('Google Calendar');
    });

    it('suppresses account name when sensitive details are off (Req 15.6)', async () => {
      const deps = createMockDeps();
      const service = createNotificationService(deps);

      await service.notifySyncConflict('Work Calendar');

      const notif = deps.platformHandler.displayedNotifications[0];
      expect(notif.title).not.toContain('Work Calendar');
      expect(notif.title).toBe('Sync Update');
    });

    it('does not send when sync_status category is disabled', async () => {
      const deps = createMockDeps({
        preferences: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          categories: {
            ...DEFAULT_NOTIFICATION_PREFERENCES.categories,
            sync_status: false,
          },
        },
      });
      const service = createNotificationService(deps);

      const sent = await service.notifySyncConflict('Google Calendar');

      expect(sent).toBe(false);
    });
  });

  describe('notifyPaymentIssue (Req 15.2)', () => {
    it('sends a payment notification with days remaining', async () => {
      const deps = createMockDeps({
        preferences: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          showSensitiveDetails: true,
        },
      });
      const service = createNotificationService(deps);

      const sent = await service.notifyPaymentIssue(5);

      expect(sent).toBe(true);
      const notif = deps.platformHandler.displayedNotifications[0];
      expect(notif.category).toBe('payment');
      expect(notif.body).toContain('5 days');
    });

    it('uses singular "day" for 1 day remaining', async () => {
      const deps = createMockDeps({
        preferences: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          showSensitiveDetails: true,
        },
      });
      const service = createNotificationService(deps);

      await service.notifyPaymentIssue(1);

      const notif = deps.platformHandler.displayedNotifications[0];
      expect(notif.body).toContain('1 day');
      expect(notif.body).not.toContain('1 days');
    });

    it('does not send when payment category is disabled', async () => {
      const deps = createMockDeps({
        preferences: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          categories: {
            ...DEFAULT_NOTIFICATION_PREFERENCES.categories,
            payment: false,
          },
        },
      });
      const service = createNotificationService(deps);

      const sent = await service.notifyPaymentIssue(3);

      expect(sent).toBe(false);
    });
  });

  describe('notifyReauthRequired (Req 15.2)', () => {
    it('sends a re-auth notification with account name when sensitive details enabled', async () => {
      const deps = createMockDeps({
        preferences: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          showSensitiveDetails: true,
        },
      });
      const service = createNotificationService(deps);

      const sent = await service.notifyReauthRequired('Microsoft Outlook');

      expect(sent).toBe(true);
      const notif = deps.platformHandler.displayedNotifications[0];
      expect(notif.category).toBe('sync_status');
      expect(notif.title).toContain('Microsoft Outlook');
      expect(notif.data?.type).toBe('reauth_required');
    });

    it('suppresses account name when sensitive details are off', async () => {
      const deps = createMockDeps();
      const service = createNotificationService(deps);

      await service.notifyReauthRequired('Microsoft Outlook');

      const notif = deps.platformHandler.displayedNotifications[0];
      expect(notif.title).not.toContain('Microsoft Outlook');
    });
  });

  describe('notifyReminder', () => {
    it('sends a reminder notification with event title when sensitive details are enabled', async () => {
      const deps = createMockDeps({
        preferences: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          showSensitiveDetails: true,
        },
      });
      const service = createNotificationService(deps);

      const sent = await service.notifyReminder('Team Standup', 15);

      expect(sent).toBe(true);
      expect(deps.platformHandler.displayedNotifications).toHaveLength(1);

      const notif = deps.platformHandler.displayedNotifications[0];
      expect(notif.category).toBe('reminders');
      expect(notif.title).toContain('Team Standup');
      expect(notif.title).toContain('15 minutes');
      expect(notif.body).toContain('Team Standup');
      expect(notif.data?.type).toBe('reminder');
      expect(notif.data?.minutesBefore).toBe('15');
    });

    it('suppresses event title when showSensitiveDetails is false', async () => {
      const deps = createMockDeps({
        preferences: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          showSensitiveDetails: false,
        },
      });
      const service = createNotificationService(deps);

      const sent = await service.notifyReminder('Secret Meeting', 5);

      expect(sent).toBe(true);
      const notif = deps.platformHandler.displayedNotifications[0];
      expect(notif.title).not.toContain('Secret Meeting');
      expect(notif.title).toBe('Calendar Reminder');
      expect(notif.body).toContain('upcoming event');
    });

    it('does not send when reminders category is disabled', async () => {
      const deps = createMockDeps({
        preferences: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          categories: {
            ...DEFAULT_NOTIFICATION_PREFERENCES.categories,
            reminders: false,
          },
        },
      });
      const service = createNotificationService(deps);

      const sent = await service.notifyReminder('Event', 10);

      expect(sent).toBe(false);
      expect(deps.platformHandler.displayedNotifications).toHaveLength(0);
    });

    it('does not send when notifications are globally disabled', async () => {
      const deps = createMockDeps({
        preferences: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          enabled: false,
        },
      });
      const service = createNotificationService(deps);

      const sent = await service.notifyReminder('Event', 10);

      expect(sent).toBe(false);
    });
  });

  describe('scheduleReminder', () => {
    it('schedules a reminder notification for a future time', async () => {
      const deps = createMockDeps({
        preferences: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          showSensitiveDetails: true,
        },
      });
      const service = createNotificationService(deps);
      const triggerAt = new Date('2025-06-15T10:00:00Z');

      const sent = await service.scheduleReminder('Team Standup', 'evt-123', triggerAt);

      expect(sent).toBe(true);
      expect(deps.platformHandler.scheduleNotification).toHaveBeenCalled();
      expect(deps.platformHandler.scheduledNotifications).toHaveLength(1);

      const scheduled = deps.platformHandler.scheduledNotifications[0];
      expect(scheduled.payload.category).toBe('reminders');
      expect(scheduled.payload.title).toContain('Team Standup');
      expect(scheduled.payload.data?.type).toBe('scheduled_reminder');
      expect(scheduled.payload.data?.eventId).toBe('evt-123');
      expect(scheduled.triggerAt).toEqual(triggerAt);
    });

    it('suppresses event title when showSensitiveDetails is false', async () => {
      const deps = createMockDeps({
        preferences: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          showSensitiveDetails: false,
        },
      });
      const service = createNotificationService(deps);
      const triggerAt = new Date('2025-06-15T10:00:00Z');

      const sent = await service.scheduleReminder('Secret Meeting', 'evt-456', triggerAt);

      expect(sent).toBe(true);
      const scheduled = deps.platformHandler.scheduledNotifications[0];
      expect(scheduled.payload.title).not.toContain('Secret Meeting');
      expect(scheduled.payload.title).toBe('Calendar Reminder');
    });

    it('does not schedule when reminders category is disabled', async () => {
      const deps = createMockDeps({
        preferences: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          categories: {
            ...DEFAULT_NOTIFICATION_PREFERENCES.categories,
            reminders: false,
          },
        },
      });
      const service = createNotificationService(deps);
      const triggerAt = new Date('2025-06-15T10:00:00Z');

      const sent = await service.scheduleReminder('Event', 'evt-789', triggerAt);

      expect(sent).toBe(false);
      expect(deps.platformHandler.scheduledNotifications).toHaveLength(0);
    });

    it('does not schedule when OS permission is denied', async () => {
      const deps = createMockDeps({ permissionStatus: 'denied' });
      const service = createNotificationService(deps);
      const triggerAt = new Date('2025-06-15T10:00:00Z');

      const sent = await service.scheduleReminder('Event', 'evt-000', triggerAt);

      expect(sent).toBe(false);
    });
  });

  describe('sendNotification (generic)', () => {
    it('sends a notification for an enabled category', async () => {
      const deps = createMockDeps();
      const service = createNotificationService(deps);

      const sent = await service.sendNotification({
        id: 'test-1',
        category: 'reminders',
        title: 'Meeting in 15 minutes',
        body: 'Your meeting starts soon.',
      });

      expect(sent).toBe(true);
      expect(deps.platformHandler.displayedNotifications).toHaveLength(1);
    });

    it('does not send when notifications are globally disabled', async () => {
      const deps = createMockDeps({
        preferences: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          enabled: false,
        },
      });
      const service = createNotificationService(deps);

      const sent = await service.sendNotification({
        id: 'test-2',
        category: 'reminders',
        title: 'Test',
        body: 'Test body',
      });

      expect(sent).toBe(false);
    });

    it('does not send when OS permission is denied', async () => {
      const deps = createMockDeps({ permissionStatus: 'denied' });
      const service = createNotificationService(deps);

      const sent = await service.sendNotification({
        id: 'test-3',
        category: 'reminders',
        title: 'Test',
        body: 'Test body',
      });

      expect(sent).toBe(false);
    });
  });

  describe('setupBackgroundHandler (Req 15.5)', () => {
    it('delegates to the platform handler', () => {
      const deps = createMockDeps();
      const service = createNotificationService(deps);
      const callback = jest.fn();

      service.setupBackgroundHandler(callback);

      expect(deps.platformHandler.setupBackgroundHandler).toHaveBeenCalledWith(
        callback
      );
    });
  });

  describe('teardown', () => {
    it('delegates to the platform handler', () => {
      const deps = createMockDeps();
      const service = createNotificationService(deps);

      service.teardown();

      expect(deps.platformHandler.teardown).toHaveBeenCalled();
    });
  });
});

describe('buildPrivacyAwarePayload (Req 15.6)', () => {
  it('includes sensitive details when showSensitiveDetails is true', () => {
    const payload = buildPrivacyAwarePayload(
      'conflicts',
      'Conflict: Meeting with John',
      'Your meeting with John overlaps with Dentist.',
      true
    );

    expect(payload.title).toBe('Conflict: Meeting with John');
    expect(payload.body).toContain('John');
  });

  it('suppresses sensitive details when showSensitiveDetails is false', () => {
    const payload = buildPrivacyAwarePayload(
      'conflicts',
      'Conflict: Meeting with John',
      'Your meeting with John overlaps with Dentist.',
      false
    );

    expect(payload.title).toBe('Schedule Conflict Detected');
    expect(payload.body).not.toContain('John');
    expect(payload.body).not.toContain('Dentist');
    expect(payload.body).toContain('overlapping events');
  });

  it('uses category-specific generic titles for each category', () => {
    const conflicts = buildPrivacyAwarePayload('conflicts', 'X', 'Y', false);
    expect(conflicts.title).toBe('Schedule Conflict Detected');

    const reminders = buildPrivacyAwarePayload('reminders', 'X', 'Y', false);
    expect(reminders.title).toBe('Calendar Reminder');

    const sync = buildPrivacyAwarePayload('sync_status', 'X', 'Y', false);
    expect(sync.title).toBe('Sync Update');

    const payment = buildPrivacyAwarePayload('payment', 'X', 'Y', false);
    expect(payment.title).toBe('Subscription Notice');
  });

  it('includes data payload when provided', () => {
    const payload = buildPrivacyAwarePayload(
      'conflicts',
      'Title',
      'Body',
      true,
      { eventId: 'evt-123' }
    );

    expect(payload.data).toEqual({ eventId: 'evt-123' });
  });

  it('generates unique IDs for each payload', () => {
    const p1 = buildPrivacyAwarePayload('conflicts', 'A', 'B', true);
    const p2 = buildPrivacyAwarePayload('conflicts', 'A', 'B', true);

    expect(p1.id).not.toBe(p2.id);
  });
});
