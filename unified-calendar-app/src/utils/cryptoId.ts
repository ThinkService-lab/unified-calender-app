/**
 * Cryptographically secure ID generation utilities.
 *
 * Replaces Math.random()-based UUID generation throughout the codebase.
 * Uses Web Crypto API (available in browsers, Node.js 19+, React Native Hermes).
 *
 * Security Review 2026-05-01: Finding H2
 */

/**
 * Generate a cryptographically secure UUID v4.
 *
 * Uses `crypto.randomUUID()` when available, falls back to
 * `crypto.getRandomValues()` for environments that lack it.
 */
export function cryptoUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback: construct UUID v4 from random bytes
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Set version (4) and variant (10xx) bits per RFC 4122
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Generate a cryptographically secure short ID.
 *
 * Format: `{timestamp}-{random}` where random is 10 hex chars from
 * crypto.getRandomValues(). Suitable for sync queue entries and other
 * internal IDs where UUID format is not required.
 */
export function cryptoId(): string {
  const bytes = new Uint8Array(5); // 5 bytes = 10 hex chars
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${Date.now()}-${random}`;
}
