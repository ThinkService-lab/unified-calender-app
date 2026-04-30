/**
 * Tests for calendar pattern assignment for color-blind users.
 * Requirements: 9.6
 */

import {
  CALENDAR_PATTERNS,
  getCalendarPattern,
  getCalendarPatternIcon,
  buildAccountPatternMap,
} from '../calendarPatterns';

describe('CALENDAR_PATTERNS', () => {
  it('has 12 patterns matching the color palette size', () => {
    expect(CALENDAR_PATTERNS).toHaveLength(12);
  });

  it('each pattern has a unique id', () => {
    const ids = CALENDAR_PATTERNS.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('each pattern has a non-empty icon', () => {
    for (const pattern of CALENDAR_PATTERNS) {
      expect(pattern.icon.length).toBeGreaterThan(0);
    }
  });

  it('each pattern has a non-empty label', () => {
    for (const pattern of CALENDAR_PATTERNS) {
      expect(pattern.label.length).toBeGreaterThan(0);
    }
  });

  it('each pattern has a unique icon', () => {
    const icons = CALENDAR_PATTERNS.map((p) => p.icon);
    const uniqueIcons = new Set(icons);
    expect(uniqueIcons.size).toBe(icons.length);
  });
});

describe('getCalendarPattern', () => {
  it('returns the first pattern for index 0', () => {
    const pattern = getCalendarPattern(0);
    expect(pattern.id).toBe('solid');
  });

  it('returns different patterns for different indices', () => {
    const p0 = getCalendarPattern(0);
    const p1 = getCalendarPattern(1);
    const p2 = getCalendarPattern(2);
    expect(p0.id).not.toBe(p1.id);
    expect(p1.id).not.toBe(p2.id);
  });

  it('cycles patterns when index exceeds pattern count', () => {
    const p0 = getCalendarPattern(0);
    const p12 = getCalendarPattern(12);
    expect(p0.id).toBe(p12.id);
  });

  it('returns a valid pattern for any non-negative index', () => {
    for (let i = 0; i < 30; i++) {
      const pattern = getCalendarPattern(i);
      expect(pattern).toBeDefined();
      expect(pattern.id).toBeDefined();
      expect(pattern.icon).toBeDefined();
    }
  });
});

describe('getCalendarPatternIcon', () => {
  it('returns the icon string for a given index', () => {
    const icon = getCalendarPatternIcon(0);
    expect(icon).toBe('●');
  });

  it('returns different icons for different indices', () => {
    const icon0 = getCalendarPatternIcon(0);
    const icon1 = getCalendarPatternIcon(1);
    expect(icon0).not.toBe(icon1);
  });
});

describe('buildAccountPatternMap', () => {
  it('builds a map from account IDs to patterns', () => {
    const accounts = [
      { id: 'acc-1' },
      { id: 'acc-2' },
      { id: 'acc-3' },
    ];
    const map = buildAccountPatternMap(accounts);

    expect(Object.keys(map)).toHaveLength(3);
    expect(map['acc-1'].id).toBe('solid');
    expect(map['acc-2'].id).toBe('stripe');
    expect(map['acc-3'].id).toBe('dot');
  });

  it('assigns unique patterns to each account (up to 12)', () => {
    const accounts = Array.from({ length: 12 }, (_, i) => ({ id: `acc-${i}` }));
    const map = buildAccountPatternMap(accounts);

    const patternIds = Object.values(map).map((p) => p.id);
    const uniquePatternIds = new Set(patternIds);
    expect(uniquePatternIds.size).toBe(12);
  });

  it('handles empty accounts array', () => {
    const map = buildAccountPatternMap([]);
    expect(Object.keys(map)).toHaveLength(0);
  });
});
