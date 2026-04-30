/**
 * Unit tests for colorCoding – color assignment per calendar account.
 * Requirements: 2.3
 */

import {
  CALENDAR_COLOR_PALETTE,
  getAccountColor,
  buildAccountColorMap,
  getEventBackgroundColor,
  getEventBorderColor,
} from '../colorCoding';

describe('getAccountColor', () => {
  test('returns account color when provided', () => {
    expect(getAccountColor('#FF0000', 0)).toBe('#FF0000');
  });

  test('returns palette color when account color is empty', () => {
    expect(getAccountColor('', 0)).toBe(CALENDAR_COLOR_PALETTE[0]);
    expect(getAccountColor('', 1)).toBe(CALENDAR_COLOR_PALETTE[1]);
  });

  test('returns palette color when account color is undefined', () => {
    expect(getAccountColor(undefined, 2)).toBe(CALENDAR_COLOR_PALETTE[2]);
  });

  test('wraps around palette for large indices', () => {
    const paletteSize = CALENDAR_COLOR_PALETTE.length;
    expect(getAccountColor('', paletteSize)).toBe(CALENDAR_COLOR_PALETTE[0]);
    expect(getAccountColor('', paletteSize + 1)).toBe(CALENDAR_COLOR_PALETTE[1]);
  });
});

describe('buildAccountColorMap', () => {
  test('builds map from accounts', () => {
    const accounts = [
      { id: 'acc-1', color: '#FF0000' },
      { id: 'acc-2', color: '#00FF00' },
    ];
    const map = buildAccountColorMap(accounts);
    expect(map['acc-1']).toBe('#FF0000');
    expect(map['acc-2']).toBe('#00FF00');
  });

  test('returns empty map for empty accounts', () => {
    expect(buildAccountColorMap([])).toEqual({});
  });

  test('assigns palette colors when account color is empty', () => {
    const accounts = [
      { id: 'acc-1', color: '' },
      { id: 'acc-2', color: '' },
    ];
    const map = buildAccountColorMap(accounts);
    expect(map['acc-1']).toBe(CALENDAR_COLOR_PALETTE[0]);
    expect(map['acc-2']).toBe(CALENDAR_COLOR_PALETTE[1]);
  });
});

describe('getEventBackgroundColor', () => {
  test('returns rgba with 0.15 alpha', () => {
    const result = getEventBackgroundColor('#1A73E8');
    expect(result).toBe('rgba(26, 115, 232, 0.15)');
  });

  test('handles pure red', () => {
    const result = getEventBackgroundColor('#FF0000');
    expect(result).toBe('rgba(255, 0, 0, 0.15)');
  });
});

describe('getEventBorderColor', () => {
  test('returns rgba with 0.4 alpha', () => {
    const result = getEventBorderColor('#1A73E8');
    expect(result).toBe('rgba(26, 115, 232, 0.4)');
  });
});

describe('CALENDAR_COLOR_PALETTE', () => {
  test('has at least 10 distinct colors', () => {
    expect(CALENDAR_COLOR_PALETTE.length).toBeGreaterThanOrEqual(10);
    const unique = new Set(CALENDAR_COLOR_PALETTE);
    expect(unique.size).toBe(CALENDAR_COLOR_PALETTE.length);
  });

  test('all colors are valid hex format', () => {
    for (const color of CALENDAR_COLOR_PALETTE) {
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
