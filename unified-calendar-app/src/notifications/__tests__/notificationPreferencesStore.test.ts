/**
 * Unit tests for NotificationPreferencesStore.
 * Requirements: 15.4, 15.6
 */

import { createNotificationPreferencesStore } from '../notificationPreferencesStore';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../types';

describe('NotificationPreferencesStore', () => {
  let store: ReturnType<typeof createNotificationPreferencesStore>;

  beforeEach(() => {
    store = createNotificationPreferencesStore();
  });

  describe('initial state', () => {
    it('starts with default preferences', () => {
      const state = store.getState();
      expect(state.preferences).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    });

    it('starts with undetermined permission status', () => {
      const state = store.getState();
      expect(state.permissionStatus).toBe('undetermined');
    });
  });

  describe('setEnabled', () => {
    it('enables notifications globally', () => {
      store.getState().setEnabled(true);
      expect(store.getState().preferences.enabled).toBe(true);
    });

    it('disables notifications globally', () => {
      store.getState().setEnabled(false);
      expect(store.getState().preferences.enabled).toBe(false);
    });
  });

  describe('setCategoryEnabled (Req 15.4)', () => {
    it('enables a specific category', () => {
      store.getState().setCategoryEnabled('conflicts', true);
      expect(store.getState().preferences.categories.conflicts).toBe(true);
    });

    it('disables a specific category', () => {
      store.getState().setCategoryEnabled('reminders', false);
      expect(store.getState().preferences.categories.reminders).toBe(false);
    });

    it('does not affect other categories', () => {
      store.getState().setCategoryEnabled('conflicts', false);
      expect(store.getState().preferences.categories.reminders).toBe(true);
      expect(store.getState().preferences.categories.sync_status).toBe(true);
      expect(store.getState().preferences.categories.payment).toBe(true);
    });
  });

  describe('setShowSensitiveDetails (Req 15.6)', () => {
    it('enables sensitive details', () => {
      store.getState().setShowSensitiveDetails(true);
      expect(store.getState().preferences.showSensitiveDetails).toBe(true);
    });

    it('disables sensitive details', () => {
      store.getState().setShowSensitiveDetails(true);
      store.getState().setShowSensitiveDetails(false);
      expect(store.getState().preferences.showSensitiveDetails).toBe(false);
    });
  });

  describe('setPermissionStatus', () => {
    it('updates the permission status', () => {
      store.getState().setPermissionStatus('granted');
      expect(store.getState().permissionStatus).toBe('granted');
    });

    it('tracks denied status', () => {
      store.getState().setPermissionStatus('denied');
      expect(store.getState().permissionStatus).toBe('denied');
    });
  });

  describe('isCategoryEnabled', () => {
    it('returns true when globally enabled, permission granted, and category enabled', () => {
      store.getState().setEnabled(true);
      store.getState().setPermissionStatus('granted');
      store.getState().setCategoryEnabled('conflicts', true);

      expect(store.getState().isCategoryEnabled('conflicts')).toBe(true);
    });

    it('returns false when globally disabled', () => {
      store.getState().setEnabled(false);
      store.getState().setPermissionStatus('granted');

      expect(store.getState().isCategoryEnabled('conflicts')).toBe(false);
    });

    it('returns false when permission is not granted', () => {
      store.getState().setEnabled(true);
      store.getState().setPermissionStatus('denied');

      expect(store.getState().isCategoryEnabled('conflicts')).toBe(false);
    });

    it('returns false when the specific category is disabled', () => {
      store.getState().setEnabled(true);
      store.getState().setPermissionStatus('granted');
      store.getState().setCategoryEnabled('reminders', false);

      expect(store.getState().isCategoryEnabled('reminders')).toBe(false);
    });
  });

  describe('reset', () => {
    it('resets all preferences to defaults', () => {
      store.getState().setEnabled(false);
      store.getState().setCategoryEnabled('conflicts', false);
      store.getState().setShowSensitiveDetails(true);
      store.getState().setPermissionStatus('granted');

      store.getState().reset();

      const state = store.getState();
      expect(state.preferences).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
      expect(state.permissionStatus).toBe('undetermined');
    });
  });
});
