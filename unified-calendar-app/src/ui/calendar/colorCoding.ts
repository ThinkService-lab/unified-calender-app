/**
 * Color-coding utility for calendar accounts.
 * Assigns distinct, accessible colors to each calendar account.
 *
 * The palette is sourced from the Design Token System so that event
 * colours stay consistent with the active theme (light / dark) and
 * meet WCAG 2.1 AA contrast ratios automatically.
 *
 * Requirements: 1.5, 1.6, 2.3
 */

import { lightTokens } from '../tokens/designTokens';

/**
 * Default event colour palette sourced from the Design Token System.
 * Contains 15 distinct, WCAG AA-compliant colours. Components that
 * need the theme-aware palette at render time should call
 * `useTokens().colors.eventPalette` instead of referencing this
 * constant directly.
 *
 * Kept as a module-level export for backwards compatibility with
 * non-React call sites (tests, utilities) that cannot invoke hooks.
 */
export const CALENDAR_COLOR_PALETTE: readonly string[] = lightTokens.colors.eventPalette;

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
