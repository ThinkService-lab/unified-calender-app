/**
 * Web secure storage implementation using Web Crypto API.
 * Encrypts values with AES-GCM using a non-extractable CryptoKey before
 * storing in localStorage.
 * Requirements: 13.2
 *
 * Security Review 2026-05-02 (pass 3): Finding M8 — the AES-256-GCM key is
 * now generated with `extractable: false` and kept only in module-local
 * memory for the page's lifetime. This closes the same-origin
 * key-exfiltration path that existed when the key was base64-encoded into
 * `sessionStorage`. The trade-off is that encrypted values cannot survive
 * a page reload — on reload, a new key is generated and previously stored
 * ciphertext is discarded. For OAuth tokens this means the user has to
 * re-authenticate after a browser tab close, which is the standard
 * behavior for web OAuth clients without a server-side token broker.
 *
 * Security Review 2026-05-02 (pass 3): Finding L7 — silent decryption
 * failures now emit an auth-reset event through the optional
 * `onAuthReset` callback so that support can audit forced sign-outs and
 * the UI can surface a "please sign in again" affordance.
 */

import type { SecureStorage } from './types';

const STORAGE_PREFIX = 'ucal_secure_';

/**
 * Optional callback invoked when stored ciphertext cannot be decrypted and
 * is silently discarded. The key (without the storage prefix) and a reason
 * are passed so callers can log or surface the event.
 *
 * Security Review 2026-05-02 (pass 3): Finding L7
 */
export type AuthResetHandler = (key: string, reason: 'decryption_failed') => void;

export interface WebSecureStorageOptions {
  /**
   * Called when a stored value could not be decrypted and was removed.
   * Typical wiring: forward to the error display service so the UI can
   * prompt the user to sign in again.
   */
  onAuthReset?: AuthResetHandler;
}

/**
 * Module-local, non-extractable encryption key.
 * Scoped to the current page load. Cleared when the tab closes.
 * Not accessible via `crypto.subtle.exportKey` because the key is created
 * with `extractable: false`, so a compromised same-origin script cannot
 * exfiltrate the key material.
 */
let cachedKey: CryptoKey | null = null;
let cachedKeyPromise: Promise<CryptoKey> | null = null;

async function getOrCreateEncryptionKey(): Promise<CryptoKey> {
  if (cachedKey) {
    return cachedKey;
  }
  if (cachedKeyPromise) {
    return cachedKeyPromise;
  }
  cachedKeyPromise = (async () => {
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false, // extractable: false — key cannot be exported
      ['encrypt', 'decrypt'],
    );
    cachedKey = key;
    return key;
  })();
  try {
    return await cachedKeyPromise;
  } finally {
    // Clear the in-flight promise once resolution completes so subsequent
    // calls hit the cached key directly.
    cachedKeyPromise = null;
  }
}

/**
 * Reset the cached key. Testing hook only — not part of the public API.
 * Calling this in production will cause all subsequent reads of existing
 * ciphertext to fail (intentionally), and a new key will be generated
 * on next use.
 */
export function _resetEncryptionKeyForTesting(): void {
  cachedKey = null;
  cachedKeyPromise = null;
}

/**
 * Encrypt a string value using AES-256-GCM.
 * Returns a base64-encoded string containing IV + ciphertext.
 */
async function encryptValue(key: CryptoKey, plaintext: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data,
  );

  // Concatenate IV + ciphertext
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a base64-encoded IV + ciphertext string using AES-256-GCM.
 */
async function decryptValue(key: CryptoKey, encrypted: string): Promise<string> {
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));

  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Creates a SecureStorage for web using AES-256-GCM encryption backed by
 * localStorage. The encryption key lives in memory only (non-extractable
 * CryptoKey scoped to the page's lifetime).
 *
 * Known limitation: values stored in a prior page load cannot be
 * decrypted after a full page reload, because the key is not persisted.
 * For OAuth tokens this translates to "sign in again after tab close",
 * which is the accepted trade-off for web clients without a server-side
 * token broker.
 */
export function createSecureStorage(
  options: WebSecureStorageOptions = {},
): SecureStorage {
  const { onAuthReset } = options;

  return {
    async getItem(key: string): Promise<string | null> {
      if (typeof localStorage === 'undefined') return null;
      const stored = localStorage.getItem(STORAGE_PREFIX + key);
      if (stored === null) return null;
      try {
        const cryptoKey = await getOrCreateEncryptionKey();
        return await decryptValue(cryptoKey, stored);
      } catch {
        // Decryption failed — most commonly because the page reloaded and
        // the in-memory key is new. Remove the unreadable entry and notify
        // the caller so the UI can prompt for re-authentication.
        localStorage.removeItem(STORAGE_PREFIX + key);
        if (onAuthReset) {
          try {
            onAuthReset(key, 'decryption_failed');
          } catch {
            // Never let a handler bug break storage reads
          }
        }
        return null;
      }
    },
    async setItem(key: string, value: string): Promise<void> {
      if (typeof localStorage === 'undefined') return;
      const cryptoKey = await getOrCreateEncryptionKey();
      const encrypted = await encryptValue(cryptoKey, value);
      localStorage.setItem(STORAGE_PREFIX + key, encrypted);
    },
    async removeItem(key: string): Promise<void> {
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(STORAGE_PREFIX + key);
    },
  };
}
