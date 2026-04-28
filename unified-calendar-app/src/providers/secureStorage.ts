/**
 * Secure storage interface re-export.
 * Platform-specific implementations are in .ios.ts, .android.ts, .web.ts files.
 * Metro/webpack resolves the correct file based on platform.
 * Requirements: 13.2
 */

export type { SecureStorage } from './types';

/**
 * Default export — this file is never used directly.
 * Platform-specific files (secureStorage.ios.ts, secureStorage.android.ts, secureStorage.web.ts)
 * are resolved by the bundler at build time.
 */
export { createSecureStorage } from './secureStorage.web';
