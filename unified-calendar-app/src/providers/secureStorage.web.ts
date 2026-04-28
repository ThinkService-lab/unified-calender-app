/**
 * Web secure storage implementation using Web Crypto API.
 * Encrypts values with AES-GCM using a derived key before storing in localStorage.
 * Requirements: 13.2
 */

import type { SecureStorage } from './types';

const STORAGE_PREFIX = 'ucal_secure_';
const KEY_STORAGE_KEY = 'ucal_crypto_key';

/**
 * Derive a CryptoKey from a passphrase using PBKDF2.
 * In production, the passphrase would come from user credentials.
 * For the web platform, we use a device-specific key stored in sessionStorage
 * or generate one per session. Falls back to in-memory storage when
 * sessionStorage is unavailable (e.g., Node.js test environment).
 */

/** In-memory fallback for environments without sessionStorage */
let inMemoryKeyStore: Record<string, string> = {};

function getSessionItem(key: string): string | null {
  if (typeof sessionStorage !== 'undefined') {
    return sessionStorage.getItem(key);
  }
  return inMemoryKeyStore[key] ?? null;
}

function setSessionItem(key: string, value: string): void {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(key, value);
  } else {
    inMemoryKeyStore[key] = value;
  }
}

async function getOrCreateEncryptionKey(): Promise<CryptoKey> {
  const existingKeyB64 = getSessionItem(KEY_STORAGE_KEY);

  if (existingKeyB64) {
    const keyData = Uint8Array.from(atob(existingKeyB64), (c) => c.charCodeAt(0));
    return crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  // Generate a new random key
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );

  // Export and store the key material in sessionStorage (cleared on tab close)
  const exported = await crypto.subtle.exportKey('raw', key);
  const keyB64 = btoa(String.fromCharCode(...new Uint8Array(exported)));
  setSessionItem(KEY_STORAGE_KEY, keyB64);

  return key;
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
 * Creates a SecureStorage for web using AES-256-GCM encryption
 * backed by localStorage. The encryption key is stored in sessionStorage
 * (cleared when the browser tab closes).
 */
export function createSecureStorage(): SecureStorage {
  let keyPromise: Promise<CryptoKey> | null = null;

  function getKey(): Promise<CryptoKey> {
    if (!keyPromise) {
      keyPromise = getOrCreateEncryptionKey();
    }
    return keyPromise;
  }

  return {
    async getItem(key: string): Promise<string | null> {
      if (typeof localStorage === 'undefined') return null;
      const stored = localStorage.getItem(STORAGE_PREFIX + key);
      if (stored === null) return null;
      try {
        const cryptoKey = await getKey();
        return await decryptValue(cryptoKey, stored);
      } catch {
        // If decryption fails (e.g., key changed), remove the corrupted entry
        localStorage.removeItem(STORAGE_PREFIX + key);
        return null;
      }
    },
    async setItem(key: string, value: string): Promise<void> {
      if (typeof localStorage === 'undefined') return;
      const cryptoKey = await getKey();
      const encrypted = await encryptValue(cryptoKey, value);
      localStorage.setItem(STORAGE_PREFIX + key, encrypted);
    },
    async removeItem(key: string): Promise<void> {
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(STORAGE_PREFIX + key);
    },
  };
}
