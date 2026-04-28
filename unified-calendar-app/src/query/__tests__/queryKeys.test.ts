/**
 * Unit tests for centralized query key factory.
 */

import { queryKeys } from '../queryKeys';

describe('queryKeys', () => {
  describe('calendars', () => {
    it('returns base key for all calendars', () => {
      expect(queryKeys.calendars.all).toEqual(['calendars']);
    });

    it('returns scoped key for a specific account', () => {
      expect(queryKeys.calendars.byAccount('acc-1')).toEqual(['calendars', 'acc-1']);
    });

    it('produces unique keys for different accounts', () => {
      const key1 = queryKeys.calendars.byAccount('acc-1');
      const key2 = queryKeys.calendars.byAccount('acc-2');
      expect(key1).not.toEqual(key2);
    });
  });

  describe('events', () => {
    it('returns base key for all events', () => {
      expect(queryKeys.events.all).toEqual(['events']);
    });

    it('returns scoped key for a specific account', () => {
      expect(queryKeys.events.byAccount('acc-1')).toEqual(['events', 'acc-1']);
    });

    it('returns scoped key for account + date range', () => {
      const key = queryKeys.events.byRange('acc-1', '2024-01-01', '2024-01-31');
      expect(key).toEqual(['events', 'acc-1', '2024-01-01', '2024-01-31']);
    });

    it('produces unique keys for different date ranges', () => {
      const key1 = queryKeys.events.byRange('acc-1', '2024-01-01', '2024-01-31');
      const key2 = queryKeys.events.byRange('acc-1', '2024-02-01', '2024-02-28');
      expect(key1).not.toEqual(key2);
    });
  });
});
