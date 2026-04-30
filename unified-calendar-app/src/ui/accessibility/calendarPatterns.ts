/**
 * Pattern/icon assignments for color-blind users.
 * Each calendar account gets a unique visual pattern in addition to its color,
 * ensuring events are distinguishable without relying on color alone.
 * Requirements: 9.6
 */

/**
 * Pattern identifiers that can be rendered as SVG patterns or Unicode symbols.
 * Each pattern is visually distinct and works at small sizes.
 */
export type CalendarPatternId =
  | 'solid'
  | 'stripe'
  | 'dot'
  | 'crosshatch'
  | 'diamond'
  | 'zigzag'
  | 'circle'
  | 'triangle'
  | 'square'
  | 'star'
  | 'wave'
  | 'dash';

export interface CalendarPattern {
  id: CalendarPatternId;
  /** Unicode symbol for inline display (e.g., in event chips) */
  icon: string;
  /** Human-readable label for screen readers */
  label: string;
}

/**
 * Map of pattern identifiers paired with each palette color index.
 * The order matches CALENDAR_COLOR_PALETTE from colorCoding.ts.
 */
export const CALENDAR_PATTERNS: readonly CalendarPattern[] = [
  { id: 'solid', icon: '●', label: 'solid circle' },
  { id: 'stripe', icon: '▤', label: 'horizontal stripes' },
  { id: 'dot', icon: '◌', label: 'dotted' },
  { id: 'crosshatch', icon: '▦', label: 'crosshatch' },
  { id: 'diamond', icon: '◆', label: 'diamond' },
  { id: 'zigzag', icon: '⚡', label: 'zigzag' },
  { id: 'circle', icon: '○', label: 'open circle' },
  { id: 'triangle', icon: '▲', label: 'triangle' },
  { id: 'square', icon: '■', label: 'square' },
  { id: 'star', icon: '★', label: 'star' },
  { id: 'wave', icon: '〰', label: 'wave' },
  { id: 'dash', icon: '━', label: 'dash' },
] as const;

/**
 * Returns the pattern for a given account index.
 * Cycles through patterns if there are more accounts than patterns.
 */
export function getCalendarPattern(accountIndex: number): CalendarPattern {
  return CALENDAR_PATTERNS[accountIndex % CALENDAR_PATTERNS.length];
}

/**
 * Returns the pattern icon character for a given account index.
 */
export function getCalendarPatternIcon(accountIndex: number): string {
  return getCalendarPattern(accountIndex).icon;
}

/**
 * Builds a map of accountId → CalendarPattern from a list of accounts.
 */
export function buildAccountPatternMap(
  accounts: ReadonlyArray<{ id: string }>
): Record<string, CalendarPattern> {
  const map: Record<string, CalendarPattern> = {};
  for (let i = 0; i < accounts.length; i++) {
    map[accounts[i].id] = getCalendarPattern(i);
  }
  return map;
}
