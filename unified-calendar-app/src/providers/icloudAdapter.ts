/**
 * iCloud Calendar adapter — a CalDAV adapter preconfigured for Apple iCloud.
 * Uses the CalDAV protocol with iCloud-specific defaults.
 * Requirements: 1.1
 */

import type { SecureStorage, RefreshToken } from './types';
import { CalDAVAdapter, type CalDAVAdapterConfig } from './caldavAdapter';

/** iCloud CalDAV server URL */
const ICLOUD_CALDAV_URL = 'https://caldav.icloud.com';

export interface ICloudAdapterConfig {
  storage: SecureStorage;
  accountId: string;
  refreshTokenInfo: RefreshToken;
  /** iCloud user's calendar home path (e.g., /1234567890/calendars/) */
  calendarHomePath: string;
  /** Optional polling interval override (default: 300000ms / 5 min) */
  pollingIntervalMs?: number;
}

/**
 * iCloud Calendar adapter.
 * Extends CalDAVAdapter with iCloud-specific defaults and providerId 'icloud'.
 * iCloud uses standard CalDAV but with Apple-specific server URLs and
 * no push notification support (polling only).
 */
export class ICloudCalendarAdapter extends CalDAVAdapter {
  constructor(config: ICloudAdapterConfig) {
    const caldavConfig: CalDAVAdapterConfig = {
      storage: config.storage,
      accountId: config.accountId,
      refreshTokenInfo: config.refreshTokenInfo,
      serverUrl: ICLOUD_CALDAV_URL,
      calendarHomePath: config.calendarHomePath,
      pollingIntervalMs: config.pollingIntervalMs,
    };
    super(caldavConfig);

    // Override the providerId to 'icloud' instead of 'caldav'
    (this as { providerId: string }).providerId = 'icloud';
  }
}
