/**
 * AES-256-GCM encryption wrapper for database at rest.
 * Requirements: 13.2
 *
 * Provides encrypt/decrypt operations for securing SQLite database content.
 * Uses platform crypto APIs (Web Crypto API / native crypto modules).
 */

/** Encrypted data envelope */
export interface EncryptedData {
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Base64-encoded initialization vector (12 bytes for GCM) */
  iv: string;
  /** Base64-encoded authentication tag (16 bytes for GCM) */
  authTag: string;
}

/** AES-256-GCM configuration constants */
export const AES_CONFIG = {
  algorithm: 'AES-GCM' as const,
  keyLength: 256,
  ivLength: 12, // 96 bits recommended for GCM
  tagLength: 128, // 128-bit auth tag
} as const;

/**
 * Derives an AES-256 encryption key from a passphrase using PBKDF2.
 * Returns a base64-encoded key suitable for database encryption.
 */
export async function deriveEncryptionKey(
  passphrase: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey', 'deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    AES_CONFIG.keyLength
  );

  return new Uint8Array(derivedBits);
}

/**
 * Encrypts data using AES-256-GCM.
 */
export async function encrypt(
  plaintext: string,
  key: Uint8Array
): Promise<EncryptedData> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(AES_CONFIG.ivLength));

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: AES_CONFIG.algorithm },
    false,
    ['encrypt']
  );

  const encrypted = await crypto.subtle.encrypt(
    {
      name: AES_CONFIG.algorithm,
      iv: iv as BufferSource,
      tagLength: AES_CONFIG.tagLength,
    },
    cryptoKey,
    encoder.encode(plaintext) as BufferSource
  );

  // In Web Crypto, the auth tag is appended to the ciphertext
  const encryptedArray = new Uint8Array(encrypted);
  const tagStart = encryptedArray.length - AES_CONFIG.tagLength / 8;
  const ciphertext = encryptedArray.slice(0, tagStart);
  const authTag = encryptedArray.slice(tagStart);

  return {
    ciphertext: uint8ArrayToBase64(ciphertext),
    iv: uint8ArrayToBase64(iv),
    authTag: uint8ArrayToBase64(authTag),
  };
}

/**
 * Decrypts data using AES-256-GCM.
 */
export async function decrypt(
  data: EncryptedData,
  key: Uint8Array
): Promise<string> {
  const decoder = new TextDecoder();
  const iv = base64ToUint8Array(data.iv);
  const ciphertext = base64ToUint8Array(data.ciphertext);
  const authTag = base64ToUint8Array(data.authTag);

  // Combine ciphertext + authTag (Web Crypto expects them concatenated)
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: AES_CONFIG.algorithm },
    false,
    ['decrypt']
  );

  const decrypted = await crypto.subtle.decrypt(
    {
      name: AES_CONFIG.algorithm,
      iv: iv as BufferSource,
      tagLength: AES_CONFIG.tagLength,
    },
    cryptoKey,
    combined as BufferSource
  );

  return decoder.decode(decrypted);
}

/** Convert Uint8Array to base64 string */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Convert base64 string to Uint8Array */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
