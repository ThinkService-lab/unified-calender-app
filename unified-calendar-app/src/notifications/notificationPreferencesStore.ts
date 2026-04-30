/**
 * Zustand store for notification preferences.
 * Tracks per-category notification settings and sensitive detail opt-in.
 * Requirements: 15.4, 15.6
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type {
  NotificationCategory,
  NotificationPermissionStatus,
  NotificationPreferences,
} from './types';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  ALL_NOTIFICATION_CATEGORIES,
} from './types';

export interface NotificationPreferencesState {
  /** Current notification preferences */
  preferences: NotificationPreferences;
  /** Current permission status from the OS */
  permissionStatus: NotificationPermissionStatus;

  // Actions
  /** Set the global enabled flag */
  setEnabled: (enabled: boolean) => void;
  /** Enable or disable a specific notification category (Req 15.4) */
  setCategoryEnabled: (category: NotificationCategory, enabled: boolean) => void;
  /** Set whether sensitive event details are shown in notifications (Req 15.6) */
  setShowSensitiveDetails: (show: boolean) => void;
  /** Update the OS permission status */
  setPermissionStatus: (status: NotificationPermissionStatus) => void;
  /** Check if a specific category is enabled (considers global + category flags) */
  isCategoryEnabled: (category: NotificationCategory) => boolean;
  /** Reset preferences to defaults */
  reset: () => void;
}

const initialState = {
  preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
  permissionStatus: 'undetermined' as NotificationPermissionStatus,
};

/**
 * Creates the notification preferences store.
 * Follows the same pattern as other stores (immer + devtools).
 */
export function createNotificationPreferencesStore() {
  return create<NotificationPreferencesState>()(
    devtools(
      immer((set, get) => ({
        ...initialState,

        setEnabled: (enabled: boolean) =>
          set((state) => {
            state.preferences.enabled = enabled;
          }),

        setCategoryEnabled: (category: NotificationCategory, enabled: boolean) =>
          set((state) => {
            state.preferences.categories[category] = enabled;
          }),

        setShowSensitiveDetails: (show: boolean) =>
          set((state) => {
            state.preferences.showSensitiveDetails = show;
          }),

        setPermissionStatus: (status: NotificationPermissionStatus) =>
          set((state) => {
            state.permissionStatus = status;
          }),

        isCategoryEnabled: (category: NotificationCategory): boolean => {
          const { preferences, permissionStatus } = get();
          // Notifications must be globally enabled, OS permission granted,
          // and the specific category enabled
          return (
            preferences.enabled &&
            permissionStatus === 'granted' &&
            preferences.categories[category] === true
          );
        },

        reset: () => set(initialState),
      })),
      {
        name: 'NotificationPreferencesStore',
        enabled: process.env.NODE_ENV !== 'production',
      }
    )
  );
}

/** Default store instance */
export const useNotificationPreferencesStore =
  createNotificationPreferencesStore();

/** Atomic selector hooks */
export const useNotificationEnabled = () =>
  useNotificationPreferencesStore((s) => s.preferences.enabled);

export const useNotificationPermissionStatus = () =>
  useNotificationPreferencesStore((s) => s.permissionStatus);

export const useShowSensitiveDetails = () =>
  useNotificationPreferencesStore((s) => s.preferences.showSensitiveDetails);

/** Multi-field selector with useShallow */
export const useNotificationSummary = () =>
  useNotificationPreferencesStore(
    useShallow((s) => ({
      enabled: s.preferences.enabled,
      permissionStatus: s.permissionStatus,
      showSensitiveDetails: s.preferences.showSensitiveDetails,
      categories: s.preferences.categories,
    }))
  );
