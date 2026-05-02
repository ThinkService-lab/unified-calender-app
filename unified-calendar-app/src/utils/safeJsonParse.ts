/**
 * Safe JSON parsing utility.
 *
 * Wraps JSON.parse in try/catch to prevent crashes from corrupted
 * database columns or malformed provider data.
 *
 * Security Review 2026-05-01: Finding C2
 */

/**
 * Safely parse a JSON string, returning a default value on failure.
 *
 * @param value - The string to parse, or null/undefined.
 * @param defaultValue - Value to return if parsing fails. Defaults to null.
 * @returns The parsed value, or defaultValue if parsing fails.
 */
export function safeJsonParse<T>(value: string | null | undefined, defaultValue: T): T;
export function safeJsonParse<T>(value: string | null | undefined): T | null;
export function safeJsonParse<T>(
  value: string | null | undefined,
  defaultValue: T | null = null,
): T | null {
  if (value === null || value === undefined) return defaultValue;
  try {
    return JSON.parse(value) as T;
  } catch {
    return defaultValue;
  }
}
