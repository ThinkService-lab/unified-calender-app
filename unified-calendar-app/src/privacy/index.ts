/**
 * Privacy module public API.
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

export { createPrivacyLayer } from './privacyLayer';
export type { PrivacyLayer } from './privacyLayer';

export {
  createPreferenceSyncService,
  encryptPreferences,
  decryptPreferences,
} from './preferenceSyncService';
export type {
  UserPreferenceSyncService,
  UserCredentials,
} from './preferenceSyncService';
