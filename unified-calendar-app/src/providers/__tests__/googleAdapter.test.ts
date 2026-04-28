/**
 * Unit tests for GoogleCalendarAdapter.
 * Requirements: 1.1, 4.1, 4.3, 18.1, 18.3
 */

import axios from 'axios';
import {
  GoogleCalendarAdapter,
  GoogleRateLimiter,
  type GoogleAdapterConfig,
  type BatchRequest,
} from '../googleAdapter';
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
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

function createAdapter(mockAxios: ReturnType<typeof createMockAxiosInstance>) {
  mockedAxios.create.mockReturnValue(mockAxios as unknown as ReturnType<typeof axios.create>);
  const config: GoogleAdapterConfig = {
    storage: createMockStorage(),
    accountId: 'test-account',
    refreshTokenInfo: REFRESH_TOKEN,
  };
  return new GoogleCalendarAdapter(config);
}

describe('GoogleCalendarAdapter', () => {
  let mockAxios: ReturnType<typeof createMockAxiosInstance>;
  let adapter: GoogleCalendarAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAxios = createMockAxiosInstance();
    adapter = createAdapter(mockAxios);
  });

  it('should have providerId "google"', () => {
    expect(adapter.providerId).toBe('google');
  });

  // ── listCalendars ──────────────────────────────────────────────────

  describe('listCalendars', () => {
    it('should map Google calendar list response to Calendar[]', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          items: [
            { id: 'cal-1', summary: 'Work', backgroundColor: '#0000FF', primary: true, accessRole: 'owner' },
            { id: 'cal-2', summary: 'Personal', backgroundColor: '#FF0000', primary: false, accessRole: 'reader' },
          ],
        },
      });

      const calendars = await adapter.listCalendars('test-account');

      expect(calendars).toHaveLength(2);
      expect(calendars[0]).toEqual({
        id: 'cal-1',
        name: 'Work',
        color: '#0000FF',
        isPrimary: true,
        accessRole: 'owner',
      });
      expect(calendars[1]).toEqual({
        id: 'cal-2',
        name: 'Personal',
        color: '#FF0000',
        isPrimary: false,
        accessRole: 'reader',
      });
    });

    it('should return empty array when no calendars exist', async () => {
      mockAxios.get.mockResolvedValueOnce({ data: { items: [] } });
      const calendars = await adapter.listCalendars('test-account');
      expect(calendars).toEqual([]);
    });

    it('should default color and accessRole for missing fields', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          items: [{ id: 'cal-3', summary: 'Minimal', accessRole: 'unknown' }],
        },
      });

      const calendars = await adapter.listCalendars('test-account');
      expect(calendars[0].color).toBe('#4285F4');
      expect(calendars[0].accessRole).toBe('reader');
      expect(calendars[0].isPrimary).toBe(false);
    });
  });

  // ── listEvents ─────────────────────────────────────────────────────

  describe('listEvents', () => {
    it('should fetch events within a date range', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          items: [
            { id: 'evt-1', summary: 'Meeting', start: { dateTime: '2025-01-01T10:00:00Z' }, end: { dateTime: '2025-01-01T11:00:00Z' } },
          ],
        },
      });

      const range = { start: new Date('2025-01-01'), end: new Date('2025-01-31') };
      const events = await adapter.listEvents('cal-1', range);

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('evt-1');
      expect(events[0].providerData).toBeDefined();
    });

    it('should handle pagination', async () => {
      mockAxios.get
        .mockResolvedValueOnce({
          data: {
            items: [{ id: 'evt-1', summary: 'Page 1' }],
            nextPageToken: 'page2',
          },
        })
        .mockResolvedValueOnce({
          data: {
            items: [{ id: 'evt-2', summary: 'Page 2' }],
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
        providerData: { summary: 'New Event', start: { dateTime: '2025-02-01T09:00:00Z' } },
      });

      expect(eventId).toBe('new-evt-1');
      expect(mockAxios.post).toHaveBeenCalledWith(
        '/calendars/cal-1/events',
        { summary: 'New Event', start: { dateTime: '2025-02-01T09:00:00Z' } },
      );
    });
  });

  // ── updateEvent ────────────────────────────────────────────────────

  describe('updateEvent', () => {
    it('should PUT updated event data', async () => {
      mockAxios.put.mockResolvedValueOnce({ data: {} });

      await adapter.updateEvent('cal-1', 'evt-1', {
        providerData: { summary: 'Updated' },
      });

      expect(mockAxios.put).toHaveBeenCalledWith(
        '/calendars/cal-1/events/evt-1',
        { summary: 'Updated' },
      );
    });
  });

  // ── deleteEvent ────────────────────────────────────────────────────

  describe('deleteEvent', () => {
    it('should DELETE the event', async () => {
      mockAxios.delete.mockResolvedValueOnce({ data: {} });

      await adapter.deleteEvent('cal-1', 'evt-1');

      expect(mockAxios.delete).toHaveBeenCalledWith('/calendars/cal-1/events/evt-1');
    });
  });

  // ── getChanges ─────────────────────────────────────────────────────

  describe('getChanges', () => {
    it('should perform initial sync without syncToken', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          items: [
            { id: 'evt-1', summary: 'Event 1' },
            { id: 'evt-2', summary: 'Event 2' },
          ],
          nextSyncToken: 'sync-token-1',
        },
      });

      const changes = await adapter.getChanges('cal-1', null);

      expect(changes.created).toHaveLength(2);
      expect(changes.updated).toHaveLength(0);
      expect(changes.deleted).toHaveLength(0);
      expect(changes.nextSyncToken).toBe('sync-token-1');
    });

    it('should perform incremental sync with syncToken', async () => {
      mockAxios.get.mockResolvedValueOnce({
        data: {
          items: [
            { id: 'evt-1', summary: 'Updated Event', status: 'confirmed' },
            { id: 'evt-3', status: 'cancelled' },
          ],
          nextSyncToken: 'sync-token-2',
        },
      });

      const changes = await adapter.getChanges('cal-1', 'sync-token-1');

      expect(changes.created).toHaveLength(0);
      expect(changes.updated).toHaveLength(1);
      expect(changes.updated[0].id).toBe('evt-1');
      expect(changes.deleted).toEqual(['evt-3']);
      expect(changes.nextSyncToken).toBe('sync-token-2');
    });

    it('should handle paginated sync responses', async () => {
      mockAxios.get
        .mockResolvedValueOnce({
          data: {
            items: [{ id: 'evt-1', summary: 'Page 1' }],
            nextPageToken: 'page2',
          },
        })
        .mockResolvedValueOnce({
          data: {
            items: [{ id: 'evt-2', summary: 'Page 2' }],
            nextSyncToken: 'sync-final',
          },
        });

      const changes = await adapter.getChanges('cal-1', null);

      expect(changes.created).toHaveLength(2);
      expect(changes.nextSyncToken).toBe('sync-final');
    });
  });

  // ── setupPushNotification ──────────────────────────────────────────

  describe('setupPushNotification', () => {
    it('should POST to events.watch and return PushSubscription', async () => {
      const expiration = Date.now() + 7 * 24 * 60 * 60 * 1000;
      mockAxios.post.mockResolvedValueOnce({
        data: {
          id: 'channel-123',
          resourceUri: 'https://www.googleapis.com/calendar/v3/calendars/cal-1/events',
          expiration: String(expiration),
        },
      });

      const sub = await adapter.setupPushNotification('cal-1', 'https://example.com/webhook');

      expect(sub.subscriptionId).toBe('channel-123');
      expect(sub.resourceUri).toContain('calendars/cal-1/events');
      expect(sub.expiresAt).toBeInstanceOf(Date);
      expect(mockAxios.post).toHaveBeenCalledWith(
        '/calendars/cal-1/events/watch',
        expect.objectContaining({
          type: 'web_hook',
          address: 'https://example.com/webhook',
        }),
      );
    });
  });

  // ── getFreeBusy ────────────────────────────────────────────────────

  describe('getFreeBusy', () => {
    it('should POST to freeBusy and return FreeBusySlot[]', async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: {
          calendars: {
            'cal-1': {
              busy: [
                { start: '2025-01-15T09:00:00Z', end: '2025-01-15T10:00:00Z' },
                { start: '2025-01-15T14:00:00Z', end: '2025-01-15T15:00:00Z' },
              ],
            },
          },
        },
      });

      const range = { start: new Date('2025-01-15'), end: new Date('2025-01-16') };
      const slots = await adapter.getFreeBusy('cal-1', range);

      expect(slots).toHaveLength(2);
      expect(slots[0].status).toBe('busy');
      expect(slots[0].start).toEqual(new Date('2025-01-15T09:00:00Z'));
      expect(slots[1].end).toEqual(new Date('2025-01-15T15:00:00Z'));
    });

    it('should return empty array when no busy slots', async () => {
      mockAxios.post.mockResolvedValueOnce({
        data: { calendars: { 'cal-1': { busy: [] } } },
      });

      const range = { start: new Date('2025-01-15'), end: new Date('2025-01-16') };
      const slots = await adapter.getFreeBusy('cal-1', range);
      expect(slots).toEqual([]);
    });
  });

  // ── executeBatch ───────────────────────────────────────────────────

  describe('executeBatch', () => {
    it('should send multipart/mixed request and parse responses', async () => {
      const batchResponseBody = [
        '--batch_abc123',
        'Content-Type: application/http',
        '',
        'HTTP/1.1 200 OK',
        'Content-Type: application/json',
        '',
        '{"id": "evt-1", "summary": "Created"}',
        '--batch_abc123',
        'Content-Type: application/http',
        '',
        'HTTP/1.1 200 OK',
        'Content-Type: application/json',
        '',
        '{"id": "evt-2", "summary": "Updated"}',
        '--batch_abc123--',
      ].join('\r\n');

      mockAxios.post.mockResolvedValueOnce({ data: batchResponseBody });

      const requests: BatchRequest[] = [
        { method: 'POST', path: '/calendars/cal-1/events', body: { summary: 'New' } },
        { method: 'PUT', path: '/calendars/cal-1/events/evt-2', body: { summary: 'Updated' } },
      ];

      const results = await adapter.executeBatch(requests);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ id: 'evt-1', summary: 'Created' });
      expect(results[1]).toEqual({ id: 'evt-2', summary: 'Updated' });
    });

    it('should return empty array for empty batch', async () => {
      const results = await adapter.executeBatch([]);
      expect(results).toEqual([]);
    });

    it('should throw if batch exceeds max size', async () => {
      const requests: BatchRequest[] = Array.from({ length: 51 }, (_, i) => ({
        method: 'GET' as const,
        path: `/calendars/cal-1/events/evt-${i}`,
      }));

      await expect(adapter.executeBatch(requests)).rejects.toThrow(
        'Batch size 51 exceeds maximum of 50',
      );
    });
  });
});

// ── GoogleRateLimiter ────────────────────────────────────────────────

describe('GoogleRateLimiter', () => {
  let limiter: GoogleRateLimiter;

  beforeEach(() => {
    limiter = new GoogleRateLimiter();
  });

  it('should start with zero count', () => {
    expect(limiter.currentCount).toBe(0);
  });

  it('should increment count on acquire', async () => {
    await limiter.acquire();
    expect(limiter.currentCount).toBe(1);
  });

  it('should track multiple acquisitions', async () => {
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.currentCount).toBe(3);
  });

  it('should reset count', async () => {
    await limiter.acquire();
    await limiter.acquire();
    limiter.reset();
    expect(limiter.currentCount).toBe(0);
  });
});
