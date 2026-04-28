/**
 * Unit tests for ExchangeCalendarAdapter.
 * Requirements: 1.1, 4.3
 */

import axios from 'axios';
import {
  ExchangeCalendarAdapter,
  ExchangeRateLimiter,
  type ExchangeAdapterConfig,
  type ExchangeBatchRequest,
} from '../exchangeAdapter';
import type { SecureStorage, RefreshToken } from '../types';

// ── Mock axios ──────────────────────────────────────────────────────
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/** Shared mock Axios instance */
function createMockAxiosInstance() {
  return {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
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
  tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
};

function createAdapter(mockAxios: ReturnType<typeof createMockAxiosInstance>) {
  mockedAxios.create.mockReturnValue(mockAxios as unknown as ReturnType<typeof axios.create>);
  const config: ExchangeAdapterConfig = {
    storage: createMockStorage(),
    accountId: 'test-account',
    refreshTokenInfo: REFRESH_TOKEN,
  };
  return new ExchangeCalendarAdapter(config);
}

describe('ExchangeCalendarAdapter', () => {
  let mockAxios: ReturnType<typeof createMockAxiosInstance>;
  let adapter: ExchangeCalendarAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAxios = createMockAxiosInstance();
    adapter = createAdapter(mockAxios);
  });

  it('should have providerId "exchange"', () => {
    expect(adapter.providerId).toBe('exchange');
  });

  it('should accept a custom baseURL for on-premises Exchange', () => {
    mockedAxios.create.mockReturnValue(mockAxios as unknown as ReturnType<typeof axios.create>);
    const customAdapter = new ExchangeCalendarAdapter({
      storage: createMockStorage(),
      accountId: 'on-prem-account',
      refreshTokenInfo: REFRESH_TOKEN,
      baseURL: 'https://exchange.corp.example.com/v1.0',
    });
    expect(customAdapter.providerId).toBe('exchange');
  });

  // ── listCalendars ──────────────────────────────────────────────────

  describe('listCalendars', () => {
    it('should map Graph calendar list response to Calendar[]', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          value: [
            { id: 'cal-1', name: 'Work', color: 'lightBlue', isDefaultCalendar: true, canEdit: true },
            { id: 'cal-2', name: 'Personal', color: 'lightGreen', isDefaultCalendar: false, canEdit: false },
          ],
        },
      });

      const calendars = await adapter.listCalendars('test-account');

      expect(calendars).toHaveLength(2);
      expect(calendars[0]).toEqual({
        id: 'cal-1',
        name: 'Work',
        color: '#71AFE5',
        isPrimary: true,
        accessRole: 'writer',
      });
      expect(calendars[1]).toEqual({
        id: 'cal-2',
        name: 'Personal',
        color: '#7ED321',
        isPrimary: false,
        accessRole: 'reader',
      });
    });

    it('should return empty array when no calendars exist', async () => {
      mockAxios.get.mockResolvedValueOnce({ data: { value: [] } });
      const calendars = await adapter.listCalendars('test-account');
      expect(calendars).toEqual([]);
    });

    it('should default color for unknown color names', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          value: [{ id: 'cal-3', name: 'Minimal', canEdit: true }],
        },
      });

      const calendars = await adapter.listCalendars('test-account');
      expect(calendars[0].color).toBe('#0078D4');
      expect(calendars[0].isPrimary).toBe(false);
      expect(calendars[0].accessRole).toBe('writer');
    });
  });

  // ── listEvents ─────────────────────────────────────────────────────

  describe('listEvents', () => {
    it('should fetch events within a date range using calendarView', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          value: [
            {
              id: 'evt-1',
              subject: 'Meeting',
              start: { dateTime: '2025-01-01T10:00:00', timeZone: 'UTC' },
              end: { dateTime: '2025-01-01T11:00:00', timeZone: 'UTC' },
            },
          ],
        },
      });

      const range = { start: new Date('2025-01-01'), end: new Date('2025-01-31') };
      const events = await adapter.listEvents('cal-1', range);

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('evt-1');
      expect(events[0].providerData).toBeDefined();
    });

    it('should handle pagination via @odata.nextLink', async () => {
      mockAxios.get
        .mockResolvedValueOnce({
          data: {
            value: [{ id: 'evt-1', subject: 'Page 1' }],
            '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendarView?$skip=1',
          },
        })
        .mockResolvedValueOnce({
          data: {
            value: [{ id: 'evt-2', subject: 'Page 2' }],
          },
        });

      const range = { start: new Date('2025-01-01'), end: new Date('2025-01-31') };
      const events = await adapter.listEvents('cal-1', range);

      expect(events).toHaveLength(2);
      expect(mockAxios.get).toHaveBeenCalledTimes(2);
    });
  });

  // ── createEvent ────────────────────────────────────────────────────

  describe('createEvent', () => {
    it('should POST event data and return the new event ID', async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { id: 'new-evt-1' },
      });

      const eventId = await adapter.createEvent('cal-1', {
        providerData: { subject: 'New Event', start: { dateTime: '2025-02-01T09:00:00', timeZone: 'UTC' } },
      });

      expect(eventId).toBe('new-evt-1');
      expect(mockAxios.post).toHaveBeenCalledWith(
        '/me/calendars/cal-1/events',
        { subject: 'New Event', start: { dateTime: '2025-02-01T09:00:00', timeZone: 'UTC' } },
      );
    });
  });

  // ── updateEvent ────────────────────────────────────────────────────

  describe('updateEvent', () => {
    it('should PATCH updated event data', async () => {
      mockAxios.patch.mockResolvedValueOnce({ data: {} });

      await adapter.updateEvent('cal-1', 'evt-1', {
        providerData: { subject: 'Updated' },
      });

      expect(mockAxios.patch).toHaveBeenCalledWith(
        '/me/calendars/cal-1/events/evt-1',
        { subject: 'Updated' },
      );
    });
  });

  // ── deleteEvent ────────────────────────────────────────────────────

  describe('deleteEvent', () => {
    it('should DELETE the event', async () => {
      mockAxios.delete.mockResolvedValueOnce({ data: {} });

      await adapter.deleteEvent('cal-1', 'evt-1');

      expect(mockAxios.delete).toHaveBeenCalledWith('/me/calendars/cal-1/events/evt-1');
    });
  });

  // ── getChanges ─────────────────────────────────────────────────────

  describe('getChanges', () => {
    it('should perform initial sync without syncToken', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          value: [
            { id: 'evt-1', subject: 'Event 1' },
            { id: 'evt-2', subject: 'Event 2' },
          ],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=abc',
        },
      });

      const changes = await adapter.getChanges('cal-1', null);

      expect(changes.created).toHaveLength(2);
      expect(changes.updated).toHaveLength(0);
      expect(changes.deleted).toHaveLength(0);
      expect(changes.nextSyncToken).toContain('deltatoken');
    });

    it('should perform incremental sync with deltaLink', async () => {
      const deltaLink = 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=abc';
      mockAxios.get.mockResolvedValueOnce({
        data: {
          value: [
            { id: 'evt-1', subject: 'Updated Event' },
            { id: 'evt-3', '@removed': { reason: 'deleted' } },
          ],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=def',
        },
      });

      const changes = await adapter.getChanges('cal-1', deltaLink);

      expect(changes.created).toHaveLength(0);
      expect(changes.updated).toHaveLength(1);
      expect(changes.updated[0].id).toBe('evt-1');
      expect(changes.deleted).toEqual(['evt-3']);
      expect(changes.nextSyncToken).toContain('deltatoken=def');
    });

    it('should handle paginated delta responses', async () => {
      mockAxios.get
        .mockResolvedValueOnce({
          data: {
            value: [{ id: 'evt-1', subject: 'Page 1' }],
            '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$skiptoken=page2',
          },
        })
        .mockResolvedValueOnce({
          data: {
            value: [{ id: 'evt-2', subject: 'Page 2' }],
            '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=final',
          },
        });

      const changes = await adapter.getChanges('cal-1', null);

      expect(changes.created).toHaveLength(2);
      expect(changes.nextSyncToken).toContain('deltatoken=final');
    });
  });

  // ── setupPushNotification ──────────────────────────────────────────

  describe('setupPushNotification', () => {
    it('should POST to /subscriptions and return PushSubscription', async () => {
      const expirationDateTime = new Date(Date.now() + 4230 * 60 * 1000).toISOString();
      mockAxios.post.mockResolvedValueOnce({
        data: {
          id: 'sub-123',
          resource: '/me/calendars/cal-1/events',
          expirationDateTime,
          changeType: 'created,updated,deleted',
        },
      });

      const sub = await adapter.setupPushNotification('cal-1', 'https://example.com/webhook');

      expect(sub.subscriptionId).toBe('sub-123');
      expect(sub.resourceUri).toContain('calendars/cal-1/events');
      expect(sub.expiresAt).toBeInstanceOf(Date);
      expect(mockAxios.post).toHaveBeenCalledWith(
        '/subscriptions',
        expect.objectContaining({
          changeType: 'created,updated,deleted',
          notificationUrl: 'https://example.com/webhook',
          resource: '/me/calendars/cal-1/events',
        }),
      );
    });
  });

  // ── getFreeBusy ────────────────────────────────────────────────────

  describe('getFreeBusy', () => {
    it('should POST to getSchedule and return FreeBusySlot[]', async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: {
          value: [
            {
              scheduleItems: [
                {
                  start: { dateTime: '2025-01-15T09:00:00', timeZone: 'UTC' },
                  end: { dateTime: '2025-01-15T10:00:00', timeZone: 'UTC' },
                  status: 'busy',
                },
                {
                  start: { dateTime: '2025-01-15T14:00:00', timeZone: 'UTC' },
                  end: { dateTime: '2025-01-15T15:00:00', timeZone: 'UTC' },
                  status: 'tentative',
                },
              ],
            },
          ],
        },
      });

      const range = { start: new Date('2025-01-15'), end: new Date('2025-01-16') };
      const slots = await adapter.getFreeBusy!('cal-1', range);

      expect(slots).toHaveLength(2);
      expect(slots[0].status).toBe('busy');
      expect(slots[0].start).toEqual(new Date('2025-01-15T09:00:00'));
      expect(slots[1].status).toBe('tentative');
    });

    it('should return empty array when no schedule data', async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { value: [] },
      });

      const range = { start: new Date('2025-01-15'), end: new Date('2025-01-16') };
      const slots = await adapter.getFreeBusy!('cal-1', range);
      expect(slots).toEqual([]);
    });
  });

  // ── executeBatch ───────────────────────────────────────────────────

  describe('executeBatch', () => {
    it('should POST to /$batch and return parsed responses in order', async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: {
          responses: [
            { id: '2', status: 200, body: { id: 'evt-2', subject: 'Second' } },
            { id: '1', status: 200, body: { id: 'evt-1', subject: 'First' } },
          ],
        },
      });

      const requests: ExchangeBatchRequest[] = [
        { method: 'GET', url: '/me/events/evt-1' },
        { method: 'GET', url: '/me/events/evt-2' },
      ];

      const results = await adapter.executeBatch(requests);

      expect(results).toHaveLength(2);
      expect((results[0] as Record<string, unknown>).subject).toBe('First');
      expect((results[1] as Record<string, unknown>).subject).toBe('Second');
    });

    it('should return null for failed individual batch responses', async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: {
          responses: [
            { id: '1', status: 200, body: { id: 'evt-1' } },
            { id: '2', status: 404, body: { error: { message: 'Not found' } } },
          ],
        },
      });

      const requests: ExchangeBatchRequest[] = [
        { method: 'GET', url: '/me/events/evt-1' },
        { method: 'DELETE', url: '/me/events/evt-missing' },
      ];

      const results = await adapter.executeBatch(requests);

      expect(results[0]).toEqual({ id: 'evt-1' });
      expect(results[1]).toBeNull();
    });

    it('should return empty array for empty batch', async () => {
      const results = await adapter.executeBatch([]);
      expect(results).toEqual([]);
    });

    it('should throw when batch exceeds max size', async () => {
      const requests: ExchangeBatchRequest[] = Array.from({ length: 21 }, (_, i) => ({
        method: 'GET' as const,
        url: `/me/events/evt-${i}`,
      }));

      await expect(adapter.executeBatch(requests)).rejects.toThrow('exceeds maximum');
    });
  });

  // ── ExchangeRateLimiter ────────────────────────────────────────────

  describe('ExchangeRateLimiter', () => {
    it('should accept custom rate limit configuration', () => {
      mockedAxios.create.mockReturnValue(mockAxios as unknown as ReturnType<typeof axios.create>);
      const customAdapter = new ExchangeCalendarAdapter({
        storage: createMockStorage(),
        accountId: 'on-prem-account',
        refreshTokenInfo: REFRESH_TOKEN,
        rateLimitMax: 500,
        rateLimitWindowMs: 60_000,
      });
      const limiter = customAdapter.getRateLimiter();
      expect(limiter).toBeInstanceOf(ExchangeRateLimiter);
      expect(limiter.currentCount).toBe(0);
    });

    it('should use default rate limits when not configured', () => {
      const limiter = adapter.getRateLimiter();
      expect(limiter).toBeInstanceOf(ExchangeRateLimiter);
      expect(limiter.currentCount).toBe(0);
    });
  });
});
