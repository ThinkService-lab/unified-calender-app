/**
 * Microsoft Exchange adapter implementing CalendarProviderAdapter via Microsoft Graph API.
 * Modern Exchange Online uses Graph API (same as Outlook). The key distinction is
 * providerId 'exchange' targeting on-premises Exchange servers that expose Graph endpoints.
 *
 * EWS (Exchange Web Services) fallback: On-premises Exchange servers that do not expose
 * Graph endpoints require EWS SOAP API. This adapter supports a configurable baseURL
 * for on-premises Graph endpoints. For legacy EWS-only servers, a separate EWS adapter
 * would be needed (out of scope for v1 — see design doc "Exchange (EWS / Graph)" section).
 *
 * Requirements: 1.1, 4.3, 18.1, 18.3
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

/** Microsoft Graph API base URL (used by modern Exchange deployments) */
const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

/** Max subscription expiry for calendar change notifications (minutes) */
const MAX_SUBSCRIPTION_EXPIRY_MINUTES = 4230;

/** Default rate limit for Exchange via Graph: 10,000 requests per 10 minutes */
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 10_000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/** Max individual requests in a single $batch call */
const MAX_BATCH_SIZE = 20;

/**
 * Configurable rate limiter for Exchange servers.
 * On-premises Exchange servers may have different rate limits than Exchange Online,
 * so this is decoupled from OutlookRateLimiter and accepts custom configuration.
 */
export class ExchangeRateLimiter {
  private timestamps: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(
    maxRequests: number = DEFAULT_RATE_LIMIT_MAX_REQUESTS,
    windowMs: number = DEFAULT_RATE_LIMIT_WINDOW_MS,
  ) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /** Record a request and wait if rate limit is exceeded */
  async acquire(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(
      (t) => now - t < this.windowMs,
    );

    if (this.timestamps.length >= this.maxRequests) {
      const oldest = this.timestamps[0];
      const waitMs = this.windowMs - (now - oldest);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      const afterWait = Date.now();
      this.timestamps = this.timestamps.filter(
        (t) => afterWait - t < this.windowMs,
      );
    }

    this.timestamps.push(Date.now());
  }

  /** Current count of requests in the active window */
  get currentCount(): number {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(
      (t) => now - t < this.windowMs,
    );
    return this.timestamps.length;
  }

  /** Reset the limiter (useful for testing) */
  reset(): void {
    this.timestamps = [];
  }
}

export interface ExchangeAdapterConfig {
  storage: SecureStorage;
  /** Account ID for token retrieval */
  accountId: string;
  /** Refresh token info for auto-refresh */
  refreshTokenInfo: RefreshToken;
  /** Optional custom Graph base URL for on-premises Exchange servers */
  baseURL?: string;
  /** Rate limit: max requests per window (default 10000) */
  rateLimitMax?: number;
  /** Rate limit: window in ms (default 600000 = 10 minutes) */
  rateLimitWindowMs?: number;
}

export interface ExchangeBatchRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
}

/**
 * Microsoft Exchange provider adapter.
 * Uses Microsoft Graph API v1.0 with deltaLink-based incremental sync,
 * Graph subscriptions for push notifications, $batch for request batching,
 * and getSchedule for free/busy.
 */
export class ExchangeCalendarAdapter extends BaseCalendarAdapter {
  private readonly rateLimiter: ExchangeRateLimiter;
  private readonly accountId: string;
  private readonly refreshTokenInfo: RefreshToken;
  private axiosInstance: AxiosInstance | null = null;

  constructor(config: ExchangeAdapterConfig) {
    super({
      providerId: 'exchange',
      baseURL: config.baseURL ?? GRAPH_BASE_URL,
      storage: config.storage,
    });
    this.rateLimiter = new ExchangeRateLimiter(
      config.rateLimitMax,
      config.rateLimitWindowMs,
    );
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

  /** Rate-limited PATCH helper */
  private async patch<T = unknown>(url: string, data?: unknown): Promise<T> {
    await this.rateLimiter.acquire();
    const response = await this.getAxios().patch<T>(url, data);
    return response.data;
  }

  /** Rate-limited DELETE helper */
  private async del<T = unknown>(url: string): Promise<T> {
    await this.rateLimiter.acquire();
    const response = await this.getAxios().delete<T>(url);
    return response.data;
  }

  /** Expose rate limiter for testing/monitoring */
  getRateLimiter(): ExchangeRateLimiter {
    return this.rateLimiter;
  }

  // ── Calendar operations ──────────────────────────────────────────

  async listCalendars(_accountId: string): Promise<Calendar[]> {
    const data = await this.get<GraphCalendarListResponse>('/me/calendars');
    return (data.value ?? []).map(mapExchangeCalendar);
  }

  // ── Event operations ─────────────────────────────────────────────

  async listEvents(calendarId: string, range: DateRange): Promise<RawEventData[]> {
    const params: Record<string, unknown> = {
      startDateTime: range.start.toISOString(),
      endDateTime: range.end.toISOString(),
      $top: 500,
      $orderby: 'start/dateTime',
    };

    const allEvents: RawEventData[] = [];
    let nextLink: string | undefined;
    let isFirstRequest = true;

    do {
      let data: GraphEventsListResponse;
      if (isFirstRequest) {
        data = await this.get<GraphEventsListResponse>(
          `/me/calendars/${encodeURIComponent(calendarId)}/calendarView`,
          params,
        );
        isFirstRequest = false;
      } else {
        data = await this.get<GraphEventsListResponse>(nextLink!);
      }
      allEvents.push(...(data.value ?? []).map(mapExchangeEvent));
      nextLink = data['@odata.nextLink'];
    } while (nextLink);

    return allEvents;
  }

  async createEvent(calendarId: string, event: RawEventData): Promise<string> {
    const data = await this.post<GraphEvent>(
      `/me/calendars/${encodeURIComponent(calendarId)}/events`,
      event.providerData ?? {},
    );
    return data.id;
  }

  async updateEvent(
    calendarId: string,
    eventId: string,
    event: RawEventData,
  ): Promise<void> {
    await this.patch(
      `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      event.providerData ?? {},
    );
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    await this.del(
      `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    );
  }

  // ── Sync ─────────────────────────────────────────────────────────

  async getChanges(
    calendarId: string,
    syncToken: string | null,
  ): Promise<ChangeSet> {
    const created: RawEventData[] = [];
    const updated: RawEventData[] = [];
    const deleted: string[] = [];
    let nextDeltaLink = '';

    let nextLink: string | undefined;
    let isFirstRequest = true;

    if (syncToken) {
      nextLink = syncToken;
      isFirstRequest = false;
    }

    do {
      let data: GraphDeltaResponse;
      if (isFirstRequest) {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        data = await this.get<GraphDeltaResponse>(
          `/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta`,
          {
            startDateTime: thirtyDaysAgo.toISOString(),
            endDateTime: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          },
        );
        isFirstRequest = false;
      } else {
        data = await this.get<GraphDeltaResponse>(nextLink!);
      }

      for (const item of data.value ?? []) {
        if (item['@removed']) {
          deleted.push(item.id);
        } else if (syncToken) {
          updated.push(mapExchangeEvent(item));
        } else {
          created.push(mapExchangeEvent(item));
        }
      }

      nextLink = data['@odata.nextLink'];
      if (data['@odata.deltaLink']) {
        nextDeltaLink = data['@odata.deltaLink'];
      }
    } while (nextLink);

    return { created, updated, deleted, nextSyncToken: nextDeltaLink };
  }

  // ── Push notifications ───────────────────────────────────────────

  async setupPushNotification(
    calendarId: string,
    webhookUrl: string,
  ): Promise<PushSubscription> {
    const expirationDateTime = new Date(
      Date.now() + MAX_SUBSCRIPTION_EXPIRY_MINUTES * 60 * 1000,
    ).toISOString();

    const data = await this.post<GraphSubscriptionResponse>('/subscriptions', {
      changeType: 'created,updated,deleted',
      notificationUrl: webhookUrl,
      resource: `/me/calendars/${calendarId}/events`,
      expirationDateTime,
    });

    return {
      subscriptionId: data.id,
      resourceUri: data.resource,
      expiresAt: new Date(data.expirationDateTime),
    };
  }

  // ── Token revocation ──────────────────────────────────────────

  protected override async revokeTokenServerSide(accessToken: string): Promise<void> {
    await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

  // ── Free/busy ────────────────────────────────────────────────────

  async getFreeBusy(
    calendarId: string,
    range: DateRange,
  ): Promise<FreeBusySlot[]> {
    const data = await this.post<GraphScheduleResponse>(
      '/me/calendar/getSchedule',
      {
        schedules: [calendarId],
        startTime: {
          dateTime: range.start.toISOString(),
          timeZone: 'UTC',
        },
        endTime: {
          dateTime: range.end.toISOString(),
          timeZone: 'UTC',
        },
      },
    );

    const schedule = data.value?.[0];
    if (!schedule) return [];

    return (schedule.scheduleItems ?? []).map((item) => ({
      start: new Date(item.start.dateTime),
      end: new Date(item.end.dateTime),
      status: mapFreeBusyStatus(item.status),
    }));
  }

  // ── Batch requests ───────────────────────────────────────────────

  /**
   * Execute multiple API requests in a single HTTP call via Microsoft Graph $batch.
   * Each request is a { method, url, body? } object.
   * Returns an array of parsed JSON response bodies (or null on individual failure).
   */
  async executeBatch(
    requests: ExchangeBatchRequest[],
  ): Promise<(unknown | null)[]> {
    if (requests.length === 0) return [];
    if (requests.length > MAX_BATCH_SIZE) {
      throw new Error(`Batch size ${requests.length} exceeds maximum of ${MAX_BATCH_SIZE}`);
    }

    await this.rateLimiter.acquire();

    const batchPayload = {
      requests: requests.map((req, i) => ({
        id: String(i + 1),
        method: req.method,
        url: req.url,
        headers: { 'Content-Type': 'application/json' },
        ...(req.body ? { body: req.body } : {}),
      })),
    };

    const response = await this.getAxios().post<GraphBatchResponse>('/$batch', batchPayload);

    // Sort responses by id to match request order
    const sorted = (response.data.responses ?? []).sort(
      (a, b) => Number(a.id) - Number(b.id),
    );

    const results: (unknown | null)[] = [];
    for (let i = 0; i < requests.length; i++) {
      const resp = sorted.find((r) => r.id === String(i + 1));
      if (resp && resp.status >= 200 && resp.status < 300) {
        results.push(resp.body ?? null);
      } else {
        results.push(null);
      }
    }

    return results;
  }
}


// ── Microsoft Graph API response types ───────────────────────────────

interface GraphCalendarListResponse {
  value?: GraphCalendarEntry[];
  '@odata.nextLink'?: string;
}

interface GraphCalendarEntry {
  id: string;
  name: string;
  color?: string;
  isDefaultCalendar?: boolean;
  canEdit?: boolean;
}

interface GraphEventsListResponse {
  value?: GraphEvent[];
  '@odata.nextLink'?: string;
}

interface GraphEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  location?: { displayName?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isAllDay?: boolean;
  recurrence?: unknown;
  attendees?: Array<{
    emailAddress: { address: string; name?: string };
    status?: { response?: string };
  }>;
  '@removed'?: { reason: string };
  [key: string]: unknown;
}

interface GraphDeltaResponse {
  value?: GraphEvent[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

interface GraphSubscriptionResponse {
  id: string;
  resource: string;
  expirationDateTime: string;
  changeType: string;
}

interface GraphScheduleResponse {
  value?: Array<{
    scheduleItems?: Array<{
      start: { dateTime: string; timeZone?: string };
      end: { dateTime: string; timeZone?: string };
      status: string;
    }>;
  }>;
}

interface GraphBatchResponse {
  responses?: Array<{
    id: string;
    status: number;
    body?: unknown;
  }>;
}

// ── Mapping helpers ──────────────────────────────────────────────────

/** Map Exchange calendar color names to hex codes */
const EXCHANGE_COLOR_MAP: Record<string, string> = {
  auto: '#0078D4',
  lightBlue: '#71AFE5',
  lightGreen: '#7ED321',
  lightOrange: '#F5A623',
  lightGray: '#A0A0A0',
  lightYellow: '#F8E71C',
  lightTeal: '#4ECDC4',
  lightPink: '#FF6B81',
  lightBrown: '#8B6914',
  lightRed: '#FF4444',
  maxColor: '#0078D4',
};

function mapExchangeCalendar(entry: GraphCalendarEntry): Calendar {
  return {
    id: entry.id,
    name: entry.name ?? '',
    color: EXCHANGE_COLOR_MAP[entry.color ?? 'auto'] ?? '#0078D4',
    isPrimary: entry.isDefaultCalendar ?? false,
    accessRole: entry.canEdit ? 'writer' : 'reader',
  };
}

function mapExchangeEvent(item: GraphEvent): RawEventData {
  return {
    id: item.id,
    providerData: item as unknown as Record<string, unknown>,
  };
}

function mapFreeBusyStatus(status: string): FreeBusySlot['status'] {
  switch (status) {
    case 'busy':
    case 'oof':
    case 'workingElsewhere':
      return 'busy';
    case 'tentative':
      return 'tentative';
    case 'free':
    case 'unknown':
    default:
      return 'free';
  }
}
