/**
 * Google Calendar adapter implementing CalendarProviderAdapter via REST API.
 * Requirements: 1.1, 4.1, 4.3, 18.1, 18.3
 */

import type { AxiosInstance } from 'axios';
import type { FreeBusySlot } from '../types/scheduling';
import type {
  Calendar,
  RawEventData,
  DateRange,
  ChangeSet,
  PushSubscription,
  SecureStorage,
  RefreshToken,
} from './types';
import { BaseCalendarAdapter, type BaseAdapterConfig } from './baseAdapter';

/** Google Calendar REST API base URL */
const GOOGLE_BASE_URL = 'https://www.googleapis.com/calendar/v3';

/** Google batch API endpoint */
const GOOGLE_BATCH_URL = 'https://www.googleapis.com/batch/calendar/v3';

/** Max requests per 100-second window per user (Google quota) */
const RATE_LIMIT_MAX_REQUESTS = 100;
const RATE_LIMIT_WINDOW_MS = 100_000;

/** Max individual requests in a single batch */
const MAX_BATCH_SIZE = 50;

/** Tracks request timestamps for rate limiting */
export class GoogleRateLimiter {
  private timestamps: number[] = [];

  /** Record a request and check if rate limit is exceeded */
  async acquire(): Promise<void> {
    const now = Date.now();
    // Remove timestamps outside the current window
    this.timestamps = this.timestamps.filter(
      (t) => now - t < RATE_LIMIT_WINDOW_MS,
    );

    if (this.timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
      const oldest = this.timestamps[0];
      const waitMs = RATE_LIMIT_WINDOW_MS - (now - oldest);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      // Clean up again after waiting
      const afterWait = Date.now();
      this.timestamps = this.timestamps.filter(
        (t) => afterWait - t < RATE_LIMIT_WINDOW_MS,
      );
    }

    this.timestamps.push(Date.now());
  }

  /** Current count of requests in the active window */
  get currentCount(): number {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(
      (t) => now - t < RATE_LIMIT_WINDOW_MS,
    );
    return this.timestamps.length;
  }

  /** Reset the limiter (useful for testing) */
  reset(): void {
    this.timestamps = [];
  }
}

export interface GoogleAdapterConfig {
  storage: SecureStorage;
  /** Account ID for token retrieval */
  accountId: string;
  /** Refresh token info for auto-refresh */
  refreshTokenInfo: RefreshToken;
}

/**
 * Google Calendar provider adapter.
 * Uses Google Calendar REST API v3 with syncToken-based incremental sync,
 * events.watch for push notifications, and freeBusy.query for availability.
 */
export class GoogleCalendarAdapter extends BaseCalendarAdapter {
  private readonly rateLimiter: GoogleRateLimiter;
  private readonly accountId: string;
  private readonly refreshTokenInfo: RefreshToken;
  private axiosInstance: AxiosInstance | null = null;

  constructor(config: GoogleAdapterConfig) {
    super({
      providerId: 'google',
      baseURL: GOOGLE_BASE_URL,
      storage: config.storage,
    });
    this.rateLimiter = new GoogleRateLimiter();
    this.accountId = config.accountId;
    this.refreshTokenInfo = config.refreshTokenInfo;
  }

  /** Lazily create and cache the authenticated Axios instance */
  private getAxios(): AxiosInstance {
    if (!this.axiosInstance) {
      this.axiosInstance = this.createAxiosInstance(
        this.accountId,
        this.refreshTokenInfo,
      );
    }
    return this.axiosInstance;
  }

  /** Rate-limited GET helper */
  private async get<T = unknown>(url: string, params?: Record<string, unknown>): Promise<T> {
    await this.rateLimiter.acquire();
    const response = await this.getAxios().get<T>(url, { params });
    return response.data;
  }

  /** Rate-limited POST helper */
  private async post<T = unknown>(url: string, data?: unknown): Promise<T> {
    await this.rateLimiter.acquire();
    const response = await this.getAxios().post<T>(url, data);
    return response.data;
  }

  /** Rate-limited PUT helper */
  private async put<T = unknown>(url: string, data?: unknown): Promise<T> {
    await this.rateLimiter.acquire();
    const response = await this.getAxios().put<T>(url, data);
    return response.data;
  }

  /** Rate-limited DELETE helper */
  private async del<T = unknown>(url: string): Promise<T> {
    await this.rateLimiter.acquire();
    const response = await this.getAxios().delete<T>(url);
    return response.data;
  }

  // ── Calendar operations ──────────────────────────────────────────

  async listCalendars(_accountId: string): Promise<Calendar[]> {
    const data = await this.get<GoogleCalendarListResponse>('/users/me/calendarList');
    return (data.items ?? []).map(mapGoogleCalendar);
  }

  // ── Event operations ─────────────────────────────────────────────

  async listEvents(calendarId: string, range: DateRange): Promise<RawEventData[]> {
    const params: Record<string, unknown> = {
      timeMin: range.start.toISOString(),
      timeMax: range.end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500,
    };

    const allEvents: RawEventData[] = [];
    let pageToken: string | undefined;

    do {
      if (pageToken) params.pageToken = pageToken;
      const data = await this.get<GoogleEventsListResponse>(
        `/calendars/${encodeURIComponent(calendarId)}/events`,
        params,
      );
      allEvents.push(...(data.items ?? []).map(mapGoogleEvent));
      pageToken = data.nextPageToken;
    } while (pageToken);

    return allEvents;
  }

  async createEvent(calendarId: string, event: RawEventData): Promise<string> {
    const data = await this.post<GoogleEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      event.providerData ?? {},
    );
    return data.id;
  }

  async updateEvent(
    calendarId: string,
    eventId: string,
    event: RawEventData,
  ): Promise<void> {
    await this.put(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      event.providerData ?? {},
    );
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    await this.del(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    );
  }

  // ── Sync ─────────────────────────────────────────────────────────

  async getChanges(
    calendarId: string,
    syncToken: string | null,
  ): Promise<ChangeSet> {
    const params: Record<string, unknown> = syncToken
      ? { syncToken }
      : { timeMin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() };

    const created: RawEventData[] = [];
    const updated: RawEventData[] = [];
    const deleted: string[] = [];
    let nextSyncToken = '';
    let pageToken: string | undefined;

    do {
      if (pageToken) params.pageToken = pageToken;
      const data = await this.get<GoogleEventsListResponse>(
        `/calendars/${encodeURIComponent(calendarId)}/events`,
        params,
      );

      for (const item of data.items ?? []) {
        if (item.status === 'cancelled') {
          deleted.push(item.id);
        } else if (syncToken) {
          // With a syncToken, all returned items are changes (updates or creates)
          updated.push(mapGoogleEvent(item));
        } else {
          created.push(mapGoogleEvent(item));
        }
      }

      pageToken = data.nextPageToken;
      if (data.nextSyncToken) {
        nextSyncToken = data.nextSyncToken;
      }
    } while (pageToken);

    return { created, updated, deleted, nextSyncToken };
  }

  // ── Push notifications ───────────────────────────────────────────

  async setupPushNotification(
    calendarId: string,
    webhookUrl: string,
  ): Promise<PushSubscription> {
    const channelId = `cal-${calendarId}-${Date.now()}`;
    const expiration = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

    const data = await this.post<GoogleWatchResponse>(
      `/calendars/${encodeURIComponent(calendarId)}/events/watch`,
      {
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        expiration,
      },
    );

    return {
      subscriptionId: data.id,
      resourceUri: data.resourceUri,
      expiresAt: new Date(Number(data.expiration)),
    };
  }

  // ── Token revocation ──────────────────────────────────────────

  /**
   * Revoke the token on Google's server.
   * Google supports token revocation via POST to their revoke endpoint.
   */
  protected override async revokeTokenServerSide(accessToken: string): Promise<void> {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }

  // ── Free/busy ────────────────────────────────────────────────────

  async getFreeBusy(
    calendarId: string,
    range: DateRange,
  ): Promise<FreeBusySlot[]> {
    const data = await this.post<GoogleFreeBusyResponse>('/freeBusy', {
      timeMin: range.start.toISOString(),
      timeMax: range.end.toISOString(),
      items: [{ id: calendarId }],
    });

    const calendarBusy = data.calendars?.[calendarId]?.busy ?? [];
    return calendarBusy.map((slot) => ({
      start: new Date(slot.start),
      end: new Date(slot.end),
      status: 'busy' as const,
    }));
  }

  // ── Batch requests ───────────────────────────────────────────────

  /**
   * Execute multiple API requests in a single HTTP call via Google's batch endpoint.
   * Each request is a { method, path, body? } object.
   * Returns an array of parsed JSON responses (or null on individual failure).
   */
  async executeBatch(
    requests: BatchRequest[],
  ): Promise<(unknown | null)[]> {
    if (requests.length === 0) return [];
    if (requests.length > MAX_BATCH_SIZE) {
      throw new Error(`Batch size ${requests.length} exceeds maximum of ${MAX_BATCH_SIZE}`);
    }

    await this.rateLimiter.acquire();

    const boundary = `batch_${Date.now()}`;
    const parts = requests.map((req, i) => {
      const bodyStr = req.body ? JSON.stringify(req.body) : '';
      const contentId = `<item-${i + 1}>`;
      let part = `--${boundary}\r\n`;
      part += `Content-Type: application/http\r\n`;
      part += `Content-ID: ${contentId}\r\n\r\n`;
      part += `${req.method} ${req.path} HTTP/1.1\r\n`;
      if (bodyStr) {
        part += `Content-Type: application/json\r\n`;
        part += `Content-Length: ${bodyStr.length}\r\n`;
      }
      part += `\r\n`;
      if (bodyStr) part += bodyStr;
      return part;
    });

    const batchBody = parts.join('\r\n') + `\r\n--${boundary}--`;

    const response = await this.getAxios().post(GOOGLE_BATCH_URL, batchBody, {
      headers: {
        'Content-Type': `multipart/mixed; boundary=${boundary}`,
      },
    });

    return parseBatchResponse(response.data, requests.length);
  }

  /** Expose rate limiter for testing/monitoring */
  getRateLimiter(): GoogleRateLimiter {
    return this.rateLimiter;
  }
}

// ── Google API response types ────────────────────────────────────────

interface GoogleCalendarListResponse {
  items?: GoogleCalendarEntry[];
  nextPageToken?: string;
}

interface GoogleCalendarEntry {
  id: string;
  summary: string;
  backgroundColor?: string;
  primary?: boolean;
  accessRole: string;
}

interface GoogleEventsListResponse {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  recurrence?: string[];
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
  [key: string]: unknown;
}

interface GoogleWatchResponse {
  id: string;
  resourceUri: string;
  expiration: string;
}

interface GoogleFreeBusyResponse {
  calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
}

export interface BatchRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
}

// ── Mapping helpers ──────────────────────────────────────────────────

function mapGoogleCalendar(entry: GoogleCalendarEntry): Calendar {
  return {
    id: entry.id,
    name: entry.summary ?? '',
    color: entry.backgroundColor ?? '#4285F4',
    isPrimary: entry.primary ?? false,
    accessRole: mapAccessRole(entry.accessRole),
  };
}

function mapAccessRole(role: string): Calendar['accessRole'] {
  switch (role) {
    case 'owner': return 'owner';
    case 'writer': return 'writer';
    case 'reader': return 'reader';
    case 'freeBusyReader': return 'freeBusyReader';
    default: return 'reader';
  }
}

function mapGoogleEvent(item: GoogleEvent): RawEventData {
  return {
    id: item.id,
    providerData: item as unknown as Record<string, unknown>,
  };
}

/**
 * Parse a multipart/mixed batch response body into individual JSON results.
 * Returns null for parts that failed to parse.
 */
function parseBatchResponse(body: string, expectedCount: number): (unknown | null)[] {
  const results: (unknown | null)[] = [];

  // Split on boundary markers — each part has HTTP status + optional JSON body
  const parts = body.split(/--batch_\w+/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === '--') continue;

    // Find the JSON body after the blank line separating headers from body
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        results.push(JSON.parse(jsonMatch[0]));
      } catch {
        results.push(null);
      }
    } else {
      results.push(null);
    }
  }

  // Pad if we got fewer results than expected
  while (results.length < expectedCount) {
    results.push(null);
  }

  return results.slice(0, expectedCount);
}
