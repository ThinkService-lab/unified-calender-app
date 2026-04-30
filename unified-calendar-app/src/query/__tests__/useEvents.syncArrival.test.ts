/**
 * Unit tests for sync-arrival delta diffing (Task 2.5B).
 *
 * These tests validate that the sync-arrival side of `useEvents` does
 * NOT spuriously fire the `syncAppear` animation on cold-start loads or
 * on refetches that return already-known events.
 *
 * The hook itself (`useEvents`) requires a React runtime, so we test
 * the extracted pure function {@link applySyncArrivalEffect} which
 * carries the identical logic the `useEffect` inside `useEvents` runs.
 * The {@link __defaultTransformForTests} helper is also exercised
 * directly to verify stable id generation for the `defaultTransform`
 * fallback path.
 *
 * Requirements: 7.4 (events that arrive from a sync operation SHALL
 *   receive the slide-in-from-right + fade-in animation — but ONLY
 *   genuinely new arrivals, not cached data replayed on launch).
 */

import {
  applySyncArrivalEffect,
  __defaultTransformForTests,
  __fnv1aHashForTests,
  __resetUseEventsSettleTrackerForTests,
} from '../useEvents';
import type { CalendarEvent } from '../../types/models';
import type { RawEventData } from '../../providers/types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeEvent(id: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const now = new Date('2026-04-01T10:00:00Z');
  return {
    id,
    providerEventId: `prov-${id}`,
    calendarAccountId: 'acc-1',
    title: `Event ${id}`,
    description: null,
    location: null,
    startTime: now,
    endTime: new Date(now.getTime() + 3600000),
    timeZone: 'UTC',
    isAllDay: false,
    recurrenceRule: null,
    recurrenceExceptionDate: null,
    parentRecurringEventId: null,
    organizer: null,
    attendees: [],
    sequence: 0,
    dtstamp: now,
    status: 'confirmed',
    visibility: null,
    opaqueFields: new Map(),
    syncStatus: 'synced',
    localVersion: 1,
    remoteEtag: null,
    modifiedBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

interface TestHarness {
  addEvents: jest.Mock;
  markArrivedFromSync: jest.Mock;
  settleKey: string;
  storeEvents: Record<string, CalendarEvent>;
}

function makeHarness(
  settleKey = JSON.stringify(['events', 'acc-1', 'range-A']),
): TestHarness {
  return {
    addEvents: jest.fn(),
    markArrivedFromSync: jest.fn(),
    settleKey,
    storeEvents: {},
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('applySyncArrivalEffect — cold-start suppression', () => {
  beforeEach(() => {
    __resetUseEventsSettleTrackerForTests();
  });

  it('does NOT call markArrivedFromSync on the first successful fetch of a query key', () => {
    const h = makeHarness();
    const events = [makeEvent('e1'), makeEvent('e2')];

    applySyncArrivalEffect({
      events,
      settleKey: h.settleKey,
      storeEvents: h.storeEvents,
      addEvents: h.addEvents,
      markArrivedFromSync: h.markArrivedFromSync,
    });

    // Events are still added to the store — only the animation trigger
    // is suppressed on cold-start.
    expect(h.addEvents).toHaveBeenCalledTimes(1);
    expect(h.addEvents).toHaveBeenCalledWith(events);

    // syncAppear animation MUST NOT fire on first load.
    expect(h.markArrivedFromSync).not.toHaveBeenCalled();
  });

  it('records the settlement so subsequent fetches are no longer "first"', () => {
    const h = makeHarness();

    // First settlement — suppressed.
    applySyncArrivalEffect({
      events: [makeEvent('e1')],
      settleKey: h.settleKey,
      storeEvents: h.storeEvents,
      addEvents: h.addEvents,
      markArrivedFromSync: h.markArrivedFromSync,
    });

    // Simulate the store now containing `e1` (addEvents was called).
    const storeAfterFirst = { e1: makeEvent('e1') };

    // Second settlement — returning a brand-new event `e2` SHOULD fire
    // markArrivedFromSync because the settlement is no longer "first".
    applySyncArrivalEffect({
      events: [makeEvent('e1'), makeEvent('e2')],
      settleKey: h.settleKey,
      storeEvents: storeAfterFirst,
      addEvents: h.addEvents,
      markArrivedFromSync: h.markArrivedFromSync,
    });

    expect(h.markArrivedFromSync).toHaveBeenCalledTimes(1);
    expect(h.markArrivedFromSync).toHaveBeenCalledWith(['e2']);
  });

  it('tracks cold-start per query key (different keys are independent)', () => {
    const ha = makeHarness(JSON.stringify(['events', 'acc-1', 'rangeA']));
    const hb = makeHarness(JSON.stringify(['events', 'acc-1', 'rangeB']));

    // Both are "first settlement" in their respective buckets, both suppressed.
    applySyncArrivalEffect({
      events: [makeEvent('a1')],
      settleKey: ha.settleKey,
      storeEvents: {},
      addEvents: ha.addEvents,
      markArrivedFromSync: ha.markArrivedFromSync,
    });
    applySyncArrivalEffect({
      events: [makeEvent('b1')],
      settleKey: hb.settleKey,
      storeEvents: { a1: makeEvent('a1') },
      addEvents: hb.addEvents,
      markArrivedFromSync: hb.markArrivedFromSync,
    });

    expect(ha.markArrivedFromSync).not.toHaveBeenCalled();
    expect(hb.markArrivedFromSync).not.toHaveBeenCalled();
  });
});

describe('applySyncArrivalEffect — per-id delta diff', () => {
  beforeEach(() => {
    __resetUseEventsSettleTrackerForTests();
  });

  it('does NOT call markArrivedFromSync when a refetch returns only known ids', () => {
    const h = makeHarness();

    // Prime the cold-start tracker with a dummy first settlement.
    applySyncArrivalEffect({
      events: [makeEvent('seed')],
      settleKey: h.settleKey,
      storeEvents: {},
      addEvents: h.addEvents,
      markArrivedFromSync: h.markArrivedFromSync,
    });
    h.addEvents.mockClear();

    // Now simulate a refetch that returns the same `seed` event —
    // nothing new arrived.
    applySyncArrivalEffect({
      events: [makeEvent('seed')],
      settleKey: h.settleKey,
      storeEvents: { seed: makeEvent('seed') },
      addEvents: h.addEvents,
      markArrivedFromSync: h.markArrivedFromSync,
    });

    // addEvents IS still called (idempotent) — but markArrivedFromSync is NOT.
    expect(h.addEvents).toHaveBeenCalledTimes(1);
    expect(h.markArrivedFromSync).not.toHaveBeenCalled();
  });

  it('calls markArrivedFromSync with ONLY the new ids when mixed with known ones', () => {
    const h = makeHarness();

    // First settlement — seeds `a` and `b`, no animation.
    applySyncArrivalEffect({
      events: [makeEvent('a'), makeEvent('b')],
      settleKey: h.settleKey,
      storeEvents: {},
      addEvents: h.addEvents,
      markArrivedFromSync: h.markArrivedFromSync,
    });

    // Second settlement — `a` and `b` are known, `c` is new.
    applySyncArrivalEffect({
      events: [makeEvent('a'), makeEvent('b'), makeEvent('c')],
      settleKey: h.settleKey,
      storeEvents: { a: makeEvent('a'), b: makeEvent('b') },
      addEvents: h.addEvents,
      markArrivedFromSync: h.markArrivedFromSync,
    });

    expect(h.markArrivedFromSync).toHaveBeenCalledTimes(1);
    expect(h.markArrivedFromSync).toHaveBeenCalledWith(['c']);
  });

  it('calls markArrivedFromSync with all ids when all are new (and not first settlement)', () => {
    const h = makeHarness();

    // Prime the tracker with a throwaway first settlement.
    applySyncArrivalEffect({
      events: [makeEvent('seed')],
      settleKey: h.settleKey,
      storeEvents: {},
      addEvents: h.addEvents,
      markArrivedFromSync: h.markArrivedFromSync,
    });

    // Second settlement — three brand-new events.
    applySyncArrivalEffect({
      events: [makeEvent('n1'), makeEvent('n2'), makeEvent('n3')],
      settleKey: h.settleKey,
      storeEvents: { seed: makeEvent('seed') },
      addEvents: h.addEvents,
      markArrivedFromSync: h.markArrivedFromSync,
    });

    expect(h.markArrivedFromSync).toHaveBeenCalledTimes(1);
    expect(h.markArrivedFromSync).toHaveBeenCalledWith(['n1', 'n2', 'n3']);
  });

  it('is a no-op when the event list is empty', () => {
    const h = makeHarness();

    applySyncArrivalEffect({
      events: [],
      settleKey: h.settleKey,
      storeEvents: {},
      addEvents: h.addEvents,
      markArrivedFromSync: h.markArrivedFromSync,
    });

    expect(h.addEvents).not.toHaveBeenCalled();
    expect(h.markArrivedFromSync).not.toHaveBeenCalled();
  });

  it('snapshots store state BEFORE addEvents so self-writes do not hide the delta', () => {
    // This test guards against a regression where the diff would run
    // AFTER addEvents populated the store — making every id look
    // "already present" and suppressing markArrivedFromSync forever.
    const h = makeHarness();

    // First settlement primes the tracker.
    applySyncArrivalEffect({
      events: [makeEvent('seed')],
      settleKey: h.settleKey,
      storeEvents: {},
      addEvents: h.addEvents,
      markArrivedFromSync: h.markArrivedFromSync,
    });

    // Second settlement with a genuinely new event — despite the
    // existence of `seed` in the store, `new-1` must still be flagged.
    applySyncArrivalEffect({
      events: [makeEvent('new-1')],
      settleKey: h.settleKey,
      storeEvents: { seed: makeEvent('seed') },
      addEvents: h.addEvents,
      markArrivedFromSync: h.markArrivedFromSync,
    });

    expect(h.markArrivedFromSync).toHaveBeenCalledWith(['new-1']);
  });
});

describe('defaultTransform — stable id generation', () => {
  it('produces the SAME id across refetches for identical raw input', () => {
    const raw: RawEventData = {
      id: null,
      title: 'Lunch',
      startTime: new Date('2026-04-15T12:00:00Z'),
    } as unknown as RawEventData;

    const a = __defaultTransformForTests(raw, 'acc-1');
    const b = __defaultTransformForTests(raw, 'acc-1');

    expect(a.id).toBe(b.id);
    // Sanity — the id has the synth- prefix (fallback path was taken).
    expect(a.id).toMatch(/^synth-[0-9a-f]{8}$/);
  });

  it('produces DIFFERENT ids for different accounts with otherwise-identical raw', () => {
    const raw: RawEventData = {
      id: null,
      title: 'Lunch',
      startTime: new Date('2026-04-15T12:00:00Z'),
    } as unknown as RawEventData;

    const a = __defaultTransformForTests(raw, 'acc-1');
    const b = __defaultTransformForTests(raw, 'acc-2');

    expect(a.id).not.toBe(b.id);
  });

  it('produces DIFFERENT ids for different titles at the same startTime', () => {
    const base = {
      id: null,
      startTime: new Date('2026-04-15T12:00:00Z'),
    };
    const a = __defaultTransformForTests(
      { ...base, title: 'Lunch' } as unknown as RawEventData,
      'acc-1',
    );
    const b = __defaultTransformForTests(
      { ...base, title: 'Dinner' } as unknown as RawEventData,
      'acc-1',
    );

    expect(a.id).not.toBe(b.id);
  });

  it('passes raw.id through unchanged when the provider supplies one', () => {
    const raw: RawEventData = {
      id: 'provider-supplied-id',
      title: 'Meeting',
    } as unknown as RawEventData;

    const out = __defaultTransformForTests(raw, 'acc-1');

    expect(out.id).toBe('provider-supplied-id');
    // The synth fallback is ONLY used when raw.id is missing.
    expect(out.id).not.toMatch(/^synth-/);
  });

  it('handles startTime as string vs Date vs undefined consistently', () => {
    const asDate: RawEventData = {
      id: null,
      title: 'T',
      startTime: new Date('2026-04-15T12:00:00Z'),
    } as unknown as RawEventData;
    const asStr: RawEventData = {
      id: null,
      title: 'T',
      startTime: '2026-04-15T12:00:00.000Z',
    } as unknown as RawEventData;
    const asUndef: RawEventData = {
      id: null,
      title: 'T',
    } as unknown as RawEventData;

    const idDate = __defaultTransformForTests(asDate, 'acc-1').id;
    const idStr = __defaultTransformForTests(asStr, 'acc-1').id;
    const idUndef = __defaultTransformForTests(asUndef, 'acc-1').id;

    // Date and string forms that represent the same instant should
    // hash to the same id (the transform normalizes both to ISO).
    expect(idDate).toBe(idStr);
    // Undefined startTime produces a different hash from a defined one.
    expect(idDate).not.toBe(idUndef);
  });
});

describe('fnv1aHash — deterministic string hash', () => {
  it('is deterministic — same input always produces the same output', () => {
    expect(__fnv1aHashForTests('foo')).toBe(__fnv1aHashForTests('foo'));
    expect(__fnv1aHashForTests('acc-1|Lunch|2026-04-15T12:00:00.000Z')).toBe(
      __fnv1aHashForTests('acc-1|Lunch|2026-04-15T12:00:00.000Z'),
    );
  });

  it('produces different hashes for different inputs', () => {
    expect(__fnv1aHashForTests('foo')).not.toBe(__fnv1aHashForTests('bar'));
  });

  it('produces an 8-character hex string', () => {
    const hash = __fnv1aHashForTests('any-input');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });
});
