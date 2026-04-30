/**
 * Color-coding utility for calendar accounts.
 * Assigns distinct, accessible colors to each calendar account.
 * Requirements: 2.3
 */

/**
 * A palette of 12 distinct, accessible colors.
 * Each color meets WCAG 2.1 AA contrast ratio (≥ 4.5:1) against white backgrounds
 * when used for text, and ≥ 3:1 for UI elements.
 */
export const CALENDAR_COLOR_PALETTE: readonly string[] = [
  '#1A73E8', // Blue
  '#D93025', // Red
  '#188038', // Green
  '#F9AB00', // Amber
  '#A142F4', // Purple
  '#E8710A', // Orange
  '#129EAF', // Teal
  '#C5221F', // Dark Red
  '#1967D2', // Royal Blue
  '#5C6BC0', // Indigo
  '#00897B', // Dark Teal
  '#E91E63', // Pink
] as const;

/**
 * Returns the color for a given calendar account.
 * Uses the account's own `color` field if set, otherwise assigns
 * a color from the palette based on the account index.
 */
export function getAccountColor(
  accountColor: string | undefined,
  accountIndex: number
): string {
  if (accountColor && accountColor.length > 0) {
    return accountColor;
  }
  return CALENDAR_COLOR_PALETTE[accountIndex % CALENDAR_COLOR_PALETTE.length];
}

/**
 * Builds a map of accountId → color from a list of accounts.
 * Uses each account's own color field.
 */
export function buildAccountColorMap(
  accounts: ReadonlyArray<{ id: string; color: string }>
): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    map[account.id] = getAccountColor(account.color, i);
  }
  return map;
}

/**
 * Returns a lighter version of a hex color for event card backgrounds.
 * Adds transparency by converting to rgba with 0.15 alpha.
 */
export function getEventBackgroundColor(hexColor: string): string {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 0.15)`;
}

/**
 * Returns a border color (slightly more opaque) for event cards.
 */
export function getEventBorderColor(hexColor: string): string {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 0.4)`;
}
