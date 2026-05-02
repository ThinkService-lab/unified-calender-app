/**
 * CalDAV adapter implementing CalendarProviderAdapter via WebDAV/CalDAV protocol.
 * Supports iCloud and generic CalDAV servers.
 * Requirements: 1.1, 4.4
 */

import type { AxiosInstance } from 'axios';
import type {
  Calendar,
  RawEventData,
  DateRange,
  ChangeSet,
  SecureStorage,
  RefreshToken,
} from './types';
import { BaseCalendarAdapter } from './baseAdapter';
// Security Review 2026-05-02: Finding H7 — replaced Math.random() UID with crypto
import { cryptoUUID } from '../utils/cryptoId';

/** Default polling interval: 5 minutes (300,000 ms) */
const DEFAULT_POLLING_INTERVAL_MS = 300_000;

/** Maximum allowed polling interval: 5 minutes */
const MAX_POLLING_INTERVAL_MS = 300_000;

/** Default CalDAV rate limit: 60 requests per 60 seconds (configurable per server) */
const DEFAULT_RATE_LIMIT_MAX = 60;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Configurable rate limiter for CalDAV servers.
 * Different CalDAV servers have different rate limits, so this is configurable.
 */
export class CalDAVRateLimiter {
  private timestamps: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number = DEFAULT_RATE_LIMIT_MAX, windowMs: number = DEFAULT_RATE_LIMIT_WINDOW_MS) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

    if (this.timestamps.length >= this.maxRequests) {
      const oldest = this.timestamps[0];
      const waitMs = this.windowMs - (now - oldest);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      const afterWait = Date.now();
      this.timestamps = this.timestamps.filter((t) => afterWait - t < this.windowMs);
    }

    this.timestamps.push(Date.now());
  }

  get currentCount(): number {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    return this.timestamps.length;
  }

  reset(): void {
    this.timestamps = [];
  }
}

export interface CalDAVAdapterConfig {
  storage: SecureStorage;
  /** Account ID for token retrieval */
  accountId: string;
  /** Refresh token info for auto-refresh */
  refreshTokenInfo: RefreshToken;
  /** CalDAV server base URL (e.g., https://caldav.icloud.com) */
  serverUrl: string;
  /** Calendar home path (e.g., /1234567890/calendars/) */
  calendarHomePath: string;
  /** Polling interval in ms (default 300000, max 300000) */
  pollingIntervalMs?: number;
  /** Rate limit: max requests per window (default 60) */
  rateLimitMax?: number;
  /** Rate limit: window in ms (default 60000) */
  rateLimitWindowMs?: number;
}

/**
 * CalDAV provider adapter.
 * Uses WebDAV/CalDAV protocol with PROPFIND, REPORT, PUT, DELETE methods.
 * Incremental sync via sync-token. No push support — polling only.
 */
export class CalDAVAdapter extends BaseCalendarAdapter {
  private readonly rateLimiter: CalDAVRateLimiter;
  private readonly accountId: string;
  private readonly refreshTokenInfo: RefreshToken;
  private readonly serverUrl: string;
  private readonly calendarHomePath: string;
  private axiosInstance: AxiosInstance | null = null;

  /** Polling interval for sync engine (≤ 5 minutes). */
  readonly pollingIntervalMs: number;

  /** Current effective polling interval (may be increased due to rate limiting) */
  private _effectivePollingIntervalMs: number;

  /** Number of consecutive rate limit events */
  private _consecutiveRateLimitHits: number = 0;

  /** Max adaptive polling interval: 30 minutes */
  private static readonly MAX_ADAPTIVE_INTERVAL_MS = 30 * 60 * 1000;

  /** Multiplier for each consecutive rate limit hit */
  private static readonly BACKOFF_MULTIPLIER = 2;

  constructor(config: CalDAVAdapterConfig) {
    super({
      providerId: 'caldav',
      baseURL: config.serverUrl,
      storage: config.storage,
    });
    this.rateLimiter = new CalDAVRateLimiter(config.rateLimitMax, config.rateLimitWindowMs);
    this.accountId = config.accountId;
    this.refreshTokenInfo = config.refreshTokenInfo;
    this.serverUrl = config.serverUrl;
    this.calendarHomePath = config.calendarHomePath;
    this.pollingIntervalMs = Math.min(
      config.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS,
      MAX_POLLING_INTERVAL_MS,
    );
    this._effectivePollingIntervalMs = this.pollingIntervalMs;
  }

  /**
   * Get the current effective polling interval.
   * This may be higher than pollingIntervalMs if the provider is being rate-limited.
   *
   * IMPORTANT for Sync Engine integration (Task 8):
   * The sync engine MUST use `effectivePollingIntervalMs` (not `pollingIntervalMs`)
   * when scheduling poll cycles for this adapter. The effective interval adapts
   * dynamically based on rate limit pressure via `onRateLimitHit()` and resets
   * to the base interval via `onSuccessfulSync()`.
   */
  get effectivePollingIntervalMs(): number {
    return this._effectivePollingIntervalMs;
  }

  /**
   * Notify the adapter that a rate limit was hit.
   * Increases the effective polling interval using exponential backoff.
   * Req 18.6: increase polling intervals for persistently rate-limited providers.
   */
  onRateLimitHit(): void {
    this._consecutiveRateLimitHits++;
    this._effectivePollingIntervalMs = Math.min(
      this.pollingIntervalMs * Math.pow(CalDAVAdapter.BACKOFF_MULTIPLIER, this._consecutiveRateLimitHits),
      CalDAVAdapter.MAX_ADAPTIVE_INTERVAL_MS,
    );
  }

  /**
   * Reset the adaptive polling interval back to the configured base.
   * Call this after a successful sync with no rate limit issues.
   */
  onSuccessfulSync(): void {
    this._consecutiveRateLimitHits = 0;
    this._effectivePollingIntervalMs = this.pollingIntervalMs;
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

  // ── WebDAV request helpers ─────────────────────────────────────────

  /** Send a rate-limited PROPFIND request */
  private async propfind<T = string>(url: string, body: string, depth: '0' | '1' = '1'): Promise<T> {
    await this.rateLimiter.acquire();
    const response = await this.getAxios().request<T>({
      method: 'PROPFIND',
      url,
      data: body,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: depth,
      },
    });
    return response.data;
  }

  /** Send a rate-limited REPORT request */
  private async report<T = string>(url: string, body: string): Promise<T> {
    await this.rateLimiter.acquire();
    const response = await this.getAxios().request<T>({
      method: 'REPORT',
      url,
      data: body,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: '1',
      },
    });
    return response.data;
  }

  /** Send a rate-limited PUT request with iCalendar body */
  private async putIcs(url: string, icsData: string, etag?: string): Promise<string> {
    await this.rateLimiter.acquire();
    const headers: Record<string, string> = {
      'Content-Type': 'text/calendar; charset=utf-8',
    };
    if (etag) {
      headers['If-Match'] = etag;
    }
    const response = await this.getAxios().put(url, icsData, { headers });
    return response.headers?.etag ?? '';
  }

  /** Send a rate-limited DELETE request */
  private async del(url: string): Promise<void> {
    await this.rateLimiter.acquire();
    await this.getAxios().delete(url);
  }

  // ── Calendar operations ──────────────────────────────────────────

  async listCalendars(_accountId: string): Promise<Calendar[]> {
    const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <cs:getctag/>
    <c:calendar-color/>
  </d:prop>
</d:propfind>`;

    const responseXml = await this.propfind<string>(this.calendarHomePath, propfindBody, '1');
    return parseCalendarListResponse(responseXml);
  }

  // ── Event operations ─────────────────────────────────────────────

  async listEvents(calendarId: string, range: DateRange): Promise<RawEventData[]> {
    const reportBody = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${formatCalDAVDate(range.start)}" end="${formatCalDAVDate(range.end)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

    const responseXml = await this.report<string>(calendarId, reportBody);
    return parseEventListResponse(responseXml);
  }

  async createEvent(calendarId: string, event: RawEventData): Promise<string> {
    const uid = event.id ?? generateUID();
    const eventUrl = `${calendarId}${uid}.ics`;
    const icsData = event.icsData ?? buildMinimalIcs(uid, event);

    await this.putIcs(eventUrl, icsData);
    return uid;
  }

  async updateEvent(
    calendarId: string,
    eventId: string,
    event: RawEventData,
  ): Promise<void> {
    const eventUrl = `${calendarId}${eventId}.ics`;
    const icsData = event.icsData ?? buildMinimalIcs(eventId, event);
    const etag = event.providerData?.etag as string | undefined;

    await this.putIcs(eventUrl, icsData, etag);
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    const eventUrl = `${calendarId}${eventId}.ics`;
    await this.del(eventUrl);
  }

  // ── Sync ─────────────────────────────────────────────────────────

  async getChanges(
    calendarId: string,
    syncToken: string | null,
  ): Promise<ChangeSet> {
    const reportBody = syncToken
      ? `<?xml version="1.0" encoding="utf-8"?>
<d:sync-collection xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:sync-token>${syncToken}</d:sync-token>
  <d:sync-level>1</d:sync-level>
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
</d:sync-collection>`
      : `<?xml version="1.0" encoding="utf-8"?>
<d:sync-collection xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:sync-token/>
  <d:sync-level>1</d:sync-level>
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
</d:sync-collection>`;

    const responseXml = await this.report<string>(calendarId, reportBody);
    return parseSyncCollectionResponse(responseXml, syncToken);
  }

  // ── No push support ──────────────────────────────────────────────
  // CalDAV does not support push notifications.
  // The sync engine should use pollingIntervalMs for periodic polling.

  /** Expose rate limiter for testing/monitoring */
  getRateLimiter(): CalDAVRateLimiter {
    return this.rateLimiter;
  }
}

// ── XML parsing helpers ──────────────────────────────────────────────

/**
 * Parse a PROPFIND multistatus response for calendar list.
 * Uses simple regex-based extraction (no XML parser dependency).
 */
function parseCalendarListResponse(xml: string): Calendar[] {
  const calendars: Calendar[] = [];
  const responses = xml.split(/<d:response>/gi).slice(1);

  for (const resp of responses) {
    // Only include resources that are calendars
    if (!/<d:resourcetype>[\s\S]*?<c:calendar\s*\/?>/i.test(resp)) {
      continue;
    }

    const href = extractTag(resp, 'd:href') ?? '';
    const displayName = extractTag(resp, 'd:displayname') ?? 'Untitled';
    const color = extractTag(resp, 'c:calendar-color') ?? '#1E90FF';

    calendars.push({
      id: href,
      name: displayName,
      color: normalizeColor(color),
      isPrimary: calendars.length === 0,
      accessRole: 'owner',
    });
  }

  return calendars;
}

/**
 * Parse a REPORT multistatus response for event list.
 */
function parseEventListResponse(xml: string): RawEventData[] {
  const events: RawEventData[] = [];
  const responses = xml.split(/<d:response>/gi).slice(1);

  for (const resp of responses) {
    const href = extractTag(resp, 'd:href') ?? '';
    const etag = extractTag(resp, 'd:getetag') ?? '';
    const calendarData = extractTag(resp, 'c:calendar-data') ?? extractTag(resp, 'cal:calendar-data') ?? '';

    if (!calendarData) continue;

    const uid = extractIcsUid(calendarData) ?? href;

    events.push({
      id: uid,
      icsData: calendarData,
      providerData: { href, etag },
    });
  }

  return events;
}

/**
 * Parse a sync-collection REPORT response for incremental changes.
 */
function parseSyncCollectionResponse(
  xml: string,
  previousSyncToken: string | null,
): ChangeSet {
  const created: RawEventData[] = [];
  const updated: RawEventData[] = [];
  const deleted: string[] = [];

  const responses = xml.split(/<d:response>/gi).slice(1);

  for (const resp of responses) {
    const href = extractTag(resp, 'd:href') ?? '';
    const statusMatch = resp.match(/<d:status>[^<]*404[^<]*<\/d:status>/i);

    if (statusMatch) {
      // 404 status in sync-collection means the resource was deleted
      const uid = extractUidFromHref(href);
      deleted.push(uid);
      continue;
    }

    const etag = extractTag(resp, 'd:getetag') ?? '';
    const calendarData = extractTag(resp, 'c:calendar-data') ?? extractTag(resp, 'cal:calendar-data') ?? '';

    if (!calendarData) continue;

    const uid = extractIcsUid(calendarData) ?? extractUidFromHref(href);
    const eventData: RawEventData = {
      id: uid,
      icsData: calendarData,
      providerData: { href, etag },
    };

    if (previousSyncToken) {
      updated.push(eventData);
    } else {
      created.push(eventData);
    }
  }

  // Extract the new sync-token from the response
  const nextSyncToken = extractTag(xml, 'd:sync-token') ?? '';

  return { created, updated, deleted, nextSyncToken };
}

// ── Utility helpers ──────────────────────────────────────────────────

/** Extract text content from a simple XML tag */
function extractTag(xml: string, tagName: string): string | null {
  // Handle both prefixed and non-prefixed variants
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

/** Extract UID from iCalendar data */
function extractIcsUid(icsData: string): string | null {
  const match = icsData.match(/^UID:(.+)$/m);
  return match ? match[1].trim() : null;
}

/** Extract a UID-like identifier from a CalDAV href */
function extractUidFromHref(href: string): string {
  const parts = href.split('/').filter(Boolean);
  const last = parts[parts.length - 1] ?? href;
  return last.replace(/\.ics$/i, '');
}

/** Format a Date as CalDAV UTC timestamp (YYYYMMDDTHHmmssZ) */
function formatCalDAVDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Normalize a color string (strip alpha channel if 9-char hex) */
function normalizeColor(color: string): string {
  const trimmed = color.trim();
  // CalDAV colors can be #RRGGBBAA — strip the alpha
  if (/^#[0-9a-fA-F]{8}$/.test(trimmed)) {
    return trimmed.slice(0, 7);
  }
  return trimmed || '#1E90FF';
}

/** Generate a simple UID for new events */
/**
 * Generate a globally unique UID for a new CalDAV event (RFC 5545 UID).
 * Security Review 2026-05-02: Finding H7 — replaced Math.random() with
 * crypto.randomUUID() to eliminate cross-server collision and
 * predictable-UID spoofing risks.
 */
function generateUID(): string {
  return `${cryptoUUID()}@unified-calendar`;
}

/** Build a minimal iCalendar string for PUT operations */
function buildMinimalIcs(uid: string, event: RawEventData): string {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//UnifiedCalendar//CalDAV//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `SUMMARY:${(event.providerData?.summary as string) ?? 'Untitled'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
