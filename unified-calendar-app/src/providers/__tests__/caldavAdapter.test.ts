/**
 * Unit tests for CalDAVAdapter.
 * Requirements: 1.1, 4.4
 */

import axios from 'axios';
import {
  CalDAVAdapter,
  type CalDAVAdapterConfig,
} from '../caldavAdapter';
import type { SecureStorage, RefreshToken } from '../types';

// ── Mock axios ──────────────────────────────────────────────────────
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/** Shared mock Axios instance */
function createMockAxiosInstance() {
  return {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    request: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
}

/** In-memory SecureStorage for testing */
function createMockStorage(): SecureStorage {
  const store = new Map<string, string>();
  return {
    async getItem(key: string) { return store.get(key) ?? null; },
    async setItem(key: string, value: string) { store.set(key, value); },
    async removeItem(key: string) { store.delete(key); },
  };
}

const REFRESH_TOKEN: RefreshToken = {
  token: 'refresh_tok',
  clientId: 'client_id',
  tokenEndpoint: 'https://auth.example.com/token',
};

function createAdapter(
  mockAxiosInst: ReturnType<typeof createMockAxiosInstance>,
  overrides?: Partial<CalDAVAdapterConfig>,
) {
  mockedAxios.create.mockReturnValue(mockAxiosInst as unknown as ReturnType<typeof axios.create>);
  const config: CalDAVAdapterConfig = {
    storage: createMockStorage(),
    accountId: 'test-account',
    refreshTokenInfo: REFRESH_TOKEN,
    serverUrl: 'https://caldav.example.com',
    calendarHomePath: '/user/calendars/',
    ...overrides,
  };
  return new CalDAVAdapter(config);
}

// ── Sample XML responses ─────────────────────────────────────────────

const CALENDAR_LIST_XML = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/user/calendars/work/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Work</d:displayname>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <c:calendar-color>#0078D4FF</c:calendar-color>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/user/calendars/personal/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Personal</d:displayname>
        <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
        <c:calendar-color>#34A853</c:calendar-color>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/user/calendars/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Calendar Home</d:displayname>
        <d:resourcetype><d:collection/></d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

const EVENT_LIST_XML = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/user/calendars/work/event1.ics</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"etag-1"</d:getetag>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-uid-1
DTSTART:20250101T100000Z
DTEND:20250101T110000Z
SUMMARY:Team Meeting
END:VEVENT
END:VCALENDAR</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/user/calendars/work/event2.ics</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"etag-2"</d:getetag>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-uid-2
DTSTART:20250102T140000Z
DTEND:20250102T150000Z
SUMMARY:Lunch
END:VEVENT
END:VCALENDAR</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

const SYNC_INITIAL_XML = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/user/calendars/work/event1.ics</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"etag-1"</d:getetag>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-uid-1
SUMMARY:Initial Event
END:VEVENT
END:VCALENDAR</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:sync-token>https://caldav.example.com/sync/token-abc</d:sync-token>
</d:multistatus>`;

const SYNC_INCREMENTAL_XML = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/user/calendars/work/event1.ics</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"etag-1-updated"</d:getetag>
        <c:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-uid-1
SUMMARY:Updated Event
END:VEVENT
END:VCALENDAR</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/user/calendars/work/event3.ics</d:href>
    <d:propstat>
      <d:prop>
        <d:status>HTTP/1.1 404 Not Found</d:status>
      </d:prop>
    </d:propstat>
  </d:response>
  <d:sync-token>https://caldav.example.com/sync/token-def</d:sync-token>
</d:multistatus>`;

describe('CalDAVAdapter', () => {
  let mockAxiosInst: ReturnType<typeof createMockAxiosInstance>;
  let adapter: CalDAVAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAxiosInst = createMockAxiosInstance();
    adapter = createAdapter(mockAxiosInst);
  });

  it('should have providerId "caldav"', () => {
    expect(adapter.providerId).toBe('caldav');
  });

  it('should have default pollingIntervalMs of 300000 (5 minutes)', () => {
    expect(adapter.pollingIntervalMs).toBe(300_000);
  });

  it('should clamp pollingIntervalMs to max 300000', () => {
    const clamped = createAdapter(mockAxiosInst, { pollingIntervalMs: 600_000 });
    expect(clamped.pollingIntervalMs).toBe(300_000);
  });

  it('should accept custom pollingIntervalMs below max', () => {
    const custom = createAdapter(mockAxiosInst, { pollingIntervalMs: 60_000 });
    expect(custom.pollingIntervalMs).toBe(60_000);
  });

  it('should NOT have setupPushNotification method', () => {
    // CalDAV does not support push — the method should not be defined
    expect((adapter as any).setupPushNotification).toBeUndefined();
  });

  it('should NOT have getFreeBusy method', () => {
    expect((adapter as any).getFreeBusy).toBeUndefined();
  });

  // ── listCalendars ──────────────────────────────────────────────────

  describe('listCalendars', () => {
    it('should PROPFIND calendar home and return Calendar[]', async () => {
      mockAxiosInst.request.mockResolvedValueOnce({ data: CALENDAR_LIST_XML });

      const calendars = await adapter.listCalendars('test-account');

      expect(calendars).toHaveLength(2);
      expect(calendars[0]).toEqual({
        id: '/user/calendars/work/',
        name: 'Work',
        color: '#0078D4',
        isPrimary: true,
        accessRole: 'owner',
      });
      expect(calendars[1]).toEqual({
        id: '/user/calendars/personal/',
        name: 'Personal',
        color: '#34A853',
        isPrimary: false,
        accessRole: 'owner',
      });

      // Verify PROPFIND was called
      expect(mockAxiosInst.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PROPFIND',
          url: '/user/calendars/',
          headers: expect.objectContaining({ Depth: '1' }),
        }),
      );
    });

    it('should return empty array when no calendars found', async () => {
      const emptyXml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/user/calendars/</d:href>
    <d:propstat>
      <d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`;
      mockAxiosInst.request.mockResolvedValueOnce({ data: emptyXml });

      const calendars = await adapter.listCalendars('test-account');
      expect(calendars).toEqual([]);
    });

    it('should strip alpha channel from 8-char hex colors', async () => {
      mockAxiosInst.request.mockResolvedValueOnce({ data: CALENDAR_LIST_XML });
      const calendars = await adapter.listCalendars('test-account');
      // #0078D4FF → #0078D4
      expect(calendars[0].color).toBe('#0078D4');
    });
  });

  // ── listEvents ─────────────────────────────────────────────────────

  describe('listEvents', () => {
    it('should REPORT calendar-query and return RawEventData[]', async () => {
      mockAxiosInst.request.mockResolvedValueOnce({ data: EVENT_LIST_XML });

      const range = { start: new Date('2025-01-01'), end: new Date('2025-01-31') };
      const events = await adapter.listEvents('/user/calendars/work/', range);

      expect(events).toHaveLength(2);
      expect(events[0].id).toBe('event-uid-1');
      expect(events[0].icsData).toContain('SUMMARY:Team Meeting');
      expect(events[0].providerData).toEqual({
        href: '/user/calendars/work/event1.ics',
        etag: '"etag-1"',
      });
      expect(events[1].id).toBe('event-uid-2');
    });

    it('should send REPORT method with time-range filter', async () => {
      mockAxiosInst.request.mockResolvedValueOnce({ data: EVENT_LIST_XML });

      const range = { start: new Date('2025-01-01T00:00:00Z'), end: new Date('2025-01-31T23:59:59Z') };
      await adapter.listEvents('/user/calendars/work/', range);

      expect(mockAxiosInst.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'REPORT',
          headers: expect.objectContaining({ Depth: '1' }),
        }),
      );
      // Verify the body contains time-range
      const callArgs = mockAxiosInst.request.mock.calls[0][0];
      expect(callArgs.data).toContain('time-range');
    });

    it('should return empty array when no events match', async () => {
      const emptyXml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>`;
      mockAxiosInst.request.mockResolvedValueOnce({ data: emptyXml });

      const range = { start: new Date('2025-06-01'), end: new Date('2025-06-30') };
      const events = await adapter.listEvents('/user/calendars/work/', range);
      expect(events).toEqual([]);
    });
  });

  // ── createEvent ────────────────────────────────────────────────────

  describe('createEvent', () => {
    it('should PUT iCalendar data and return the UID', async () => {
      mockAxiosInst.put.mockResolvedValueOnce({
        data: '',
        headers: { etag: '"new-etag"' },
      });

      const uid = await adapter.createEvent('/user/calendars/work/', {
        icsData: 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:my-uid\r\nEND:VEVENT\r\nEND:VCALENDAR',
        id: 'my-uid',
      });

      expect(uid).toBe('my-uid');
      expect(mockAxiosInst.put).toHaveBeenCalledWith(
        '/user/calendars/work/my-uid.ics',
        expect.stringContaining('BEGIN:VCALENDAR'),
        expect.objectContaining({
          headers: expect.objectContaining({ 'Content-Type': 'text/calendar; charset=utf-8' }),
        }),
      );
    });

    it('should generate a UID when event.id is not provided', async () => {
      mockAxiosInst.put.mockResolvedValueOnce({
        data: '',
        headers: { etag: '"gen-etag"' },
      });

      const uid = await adapter.createEvent('/user/calendars/work/', {
        providerData: { summary: 'Auto UID Event' },
      });

      expect(uid).toBeTruthy();
      expect(uid).toContain('@unified-calendar');
    });
  });

  // ── updateEvent ────────────────────────────────────────────────────

  describe('updateEvent', () => {
    it('should PUT updated iCalendar data with If-Match etag', async () => {
      mockAxiosInst.put.mockResolvedValueOnce({
        data: '',
        headers: { etag: '"updated-etag"' },
      });

      await adapter.updateEvent('/user/calendars/work/', 'event-uid-1', {
        icsData: 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:event-uid-1\r\nSUMMARY:Updated\r\nEND:VEVENT\r\nEND:VCALENDAR',
        providerData: { etag: '"etag-1"' },
      });

      expect(mockAxiosInst.put).toHaveBeenCalledWith(
        '/user/calendars/work/event-uid-1.ics',
        expect.stringContaining('Updated'),
        expect.objectContaining({
          headers: expect.objectContaining({ 'If-Match': '"etag-1"' }),
        }),
      );
    });

    it('should PUT without If-Match when no etag provided', async () => {
      mockAxiosInst.put.mockResolvedValueOnce({
        data: '',
        headers: {},
      });

      await adapter.updateEvent('/user/calendars/work/', 'event-uid-1', {
        providerData: { summary: 'No Etag' },
      });

      const callHeaders = mockAxiosInst.put.mock.calls[0][2]?.headers;
      expect(callHeaders).not.toHaveProperty('If-Match');
    });
  });

  // ── deleteEvent ────────────────────────────────────────────────────

  describe('deleteEvent', () => {
    it('should DELETE the event .ics resource', async () => {
      mockAxiosInst.delete.mockResolvedValueOnce({ data: '' });

      await adapter.deleteEvent('/user/calendars/work/', 'event-uid-1');

      expect(mockAxiosInst.delete).toHaveBeenCalledWith(
        '/user/calendars/work/event-uid-1.ics',
      );
    });
  });

  // ── getChanges ─────────────────────────────────────────────────────

  describe('getChanges', () => {
    it('should perform initial sync without syncToken', async () => {
      mockAxiosInst.request.mockResolvedValueOnce({ data: SYNC_INITIAL_XML });

      const changes = await adapter.getChanges('/user/calendars/work/', null);

      expect(changes.created).toHaveLength(1);
      expect(changes.created[0].id).toBe('event-uid-1');
      expect(changes.updated).toHaveLength(0);
      expect(changes.deleted).toHaveLength(0);
      expect(changes.nextSyncToken).toBe('https://caldav.example.com/sync/token-abc');
    });

    it('should send empty sync-token element for initial sync', async () => {
      mockAxiosInst.request.mockResolvedValueOnce({ data: SYNC_INITIAL_XML });

      await adapter.getChanges('/user/calendars/work/', null);

      const callArgs = mockAxiosInst.request.mock.calls[0][0];
      expect(callArgs.data).toContain('<d:sync-token/>');
    });

    it('should perform incremental sync with syncToken', async () => {
      mockAxiosInst.request.mockResolvedValueOnce({ data: SYNC_INCREMENTAL_XML });

      const changes = await adapter.getChanges(
        '/user/calendars/work/',
        'https://caldav.example.com/sync/token-abc',
      );

      expect(changes.created).toHaveLength(0);
      expect(changes.updated).toHaveLength(1);
      expect(changes.updated[0].id).toBe('event-uid-1');
      expect(changes.updated[0].icsData).toContain('Updated Event');
      expect(changes.deleted).toEqual(['event3']);
      expect(changes.nextSyncToken).toBe('https://caldav.example.com/sync/token-def');
    });

    it('should include previous sync-token in incremental request', async () => {
      mockAxiosInst.request.mockResolvedValueOnce({ data: SYNC_INCREMENTAL_XML });

      await adapter.getChanges(
        '/user/calendars/work/',
        'https://caldav.example.com/sync/token-abc',
      );

      const callArgs = mockAxiosInst.request.mock.calls[0][0];
      expect(callArgs.data).toContain('https://caldav.example.com/sync/token-abc');
    });
  });

  // ── Adaptive polling (Req 18.6) ────────────────────────────────────

  describe('adaptive polling', () => {
    it('should start with base polling interval as effective interval', () => {
      expect(adapter.effectivePollingIntervalMs).toBe(300_000);
    });

    it('should increase effective interval on rate limit hit', () => {
      adapter.onRateLimitHit();
      expect(adapter.effectivePollingIntervalMs).toBe(600_000); // 300000 * 2^1
    });

    it('should increase exponentially on consecutive hits', () => {
      adapter.onRateLimitHit(); // 2x = 600000
      adapter.onRateLimitHit(); // 4x = 1200000
      adapter.onRateLimitHit(); // 8x = 2400000, capped at 1800000
      expect(adapter.effectivePollingIntervalMs).toBe(1_800_000); // capped at 30 min
    });

    it('should cap at 30 minutes max', () => {
      for (let i = 0; i < 20; i++) {
        adapter.onRateLimitHit();
      }
      expect(adapter.effectivePollingIntervalMs).toBe(30 * 60 * 1000);
    });

    it('should reset to base interval on successful sync', () => {
      adapter.onRateLimitHit();
      adapter.onRateLimitHit();
      expect(adapter.effectivePollingIntervalMs).toBeGreaterThan(300_000);

      adapter.onSuccessfulSync();
      expect(adapter.effectivePollingIntervalMs).toBe(300_000);
    });
  });
});
