/**
 * E2E Encrypted User Preference Sync Service.
 * Syncs privacy preferences across user's devices using AES-256-GCM encryption.
 * The server stores an opaque encrypted blob it cannot decrypt.
 * Requirements: 5.6
 */

import axios, { AxiosInstance } from 'axios';
import {
  AES_CONFIG,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from '../db/encryption';
import { EncryptedPreferences } from '../types';

/** User credentials used to derive the encryption key */
export interface UserCredentials {
  userId: string;
  /** User's password or passphrase used for key derivation */
  passphrase: string;
}

/** Interface for the UserPreferenceSyncService */
export interface UserPreferenceSyncService {
  syncPreferences(userId: string): Promise<void>;
  pushPreferences(userId: string, preferences: EncryptedPreferences): Promise<void>;
  pullPreferences(userId: string): Promise<EncryptedPreferences>;
  deriveEncryptionKey(userCredentials: UserCredentials): Promise<CryptoKey>;
}

/** Server response shape for GET /preferences/:userId */
interface ServerPreferencesResponse {
  ciphertext: string;
  iv: string;
  authTag: string;
  version: number;
  updatedAt: string;
}

/** Server request shape for PUT /preferences/:userId */
interface ServerPreferencesPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
  version: number;
}

/**
 * Creates a UserPreferenceSyncService instance.
 *
 * @param baseUrl - The HTTPS base URL for the preferences API (e.g., https://api.example.com)
 * @param getAuthToken - Function that returns the current JWT bearer token
 * @param credentials - User credentials for E2E encryption key derivation (required — never defaults to insecure values)
 * @param getLocalPreferences - Function that returns the current local preferences as a JSON string
 * @param setLocalPreferences - Function that applies pulled preferences locally
 * @param getLocalVersion - Function that returns the current local preferences version number
 */
export function createPreferenceSyncService(
  baseUrl: string,
  getAuthToken: () => Promise<string>,
  credentials: UserCredentials,
  getLocalPreferences: (userId: string) => Promise<string>,
  setLocalPreferences: (userId: string, preferencesJson: string) => Promise<void>,
  getLocalVersion: (userId: string) => Promise<number>
): UserPreferenceSyncService {
  const client: AxiosInstance = axios.create({
    baseURL: baseUrl,
    timeout: 10000,
  });

  // Add auth interceptor
  client.interceptors.request.use(async (config) => {
    const token = await getAuthToken();
    config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  return {
    async deriveEncryptionKey(userCredentials: UserCredentials): Promise<CryptoKey> {
      const encoder = new TextEncoder();
      // Use userId as salt to ensure different keys per user
      const salt = encoder.encode(userCredentials.userId);

      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(userCredentials.passphrase) as BufferSource,
        'PBKDF2',
        false,
        ['deriveKey']
      );

      return crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt as BufferSource,
          iterations: 100000,
          hash: 'SHA-256',
        },
        keyMaterial,
        { name: AES_CONFIG.algorithm, length: AES_CONFIG.keyLength },
        false,
        ['encrypt', 'decrypt']
      );
    },

    async pushPreferences(userId: string, preferences: EncryptedPreferences): Promise<void> {
      const payload: ServerPreferencesPayload = {
        ciphertext: preferences.ciphertext,
        iv: preferences.iv,
        authTag: preferences.authTag,
        version: preferences.version,
      };

      await client.put(`/preferences/${userId}`, payload);
    },

    async pullPreferences(userId: string): Promise<EncryptedPreferences> {
      const response = await client.get<ServerPreferencesResponse>(`/preferences/${userId}`);
      const data = response.data;

      return {
        ciphertext: data.ciphertext,
        iv: data.iv,
        authTag: data.authTag,
        version: data.version,
        updatedAt: new Date(data.updatedAt),
      };
    },

    async syncPreferences(userId: string): Promise<void> {
      // Pull remote preferences, decrypt, and apply locally.
      // If no remote preferences exist, push local preferences.
      // Version comparison determines which side wins.
      try {
        const remote = await this.pullPreferences(userId);
        const localVersion = await getLocalVersion(userId);

        if (remote.version > localVersion) {
          // Remote is newer — decrypt and apply locally
          const key = await this.deriveEncryptionKey(credentials);
          const decryptedJson = await decryptPreferences(remote, key);
          await setLocalPreferences(userId, decryptedJson);
        } else if (localVersion > remote.version) {
          // Local is newer — encrypt and push to server
          const localJson = await getLocalPreferences(userId);
          const encrypted = await encryptPreferences(localJson, credentials, localVersion);
          await this.pushPreferences(userId, encrypted);
        }
        // If versions are equal, no sync needed (already in sync)
      } catch (error: unknown) {
        if (isAxios404(error)) {
          // No remote preferences yet — encrypt local and push
          const localJson = await getLocalPreferences(userId);
          const localVersion = await getLocalVersion(userId);
          const encrypted = await encryptPreferences(localJson, credentials, localVersion);
          await this.pushPreferences(userId, encrypted);
        } else {
          throw error;
        }
      }
    },
  };
}

/**
 * Encrypts a preferences JSON string using AES-256-GCM.
 * Returns an EncryptedPreferences object ready for server storage.
 *
 * @param preferencesJson - The plaintext preferences JSON to encrypt
 * @param credentials - User credentials for key derivation (required)
 * @param version - The version number to stamp on the encrypted blob
 */
export async function encryptPreferences(
  preferencesJson: string,
  credentials: UserCredentials,
  version: number = 1
): Promise<EncryptedPreferences> {
  const key = await deriveKeyFromCredentials(credentials);

  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(AES_CONFIG.ivLength));

  const encrypted = await crypto.subtle.encrypt(
    {
      name: AES_CONFIG.algorithm,
      iv: iv as BufferSource,
      tagLength: AES_CONFIG.tagLength,
    },
    key,
    encoder.encode(preferencesJson) as BufferSource
  );

  // Web Crypto appends auth tag to ciphertext
  const encryptedArray = new Uint8Array(encrypted);
  const tagStart = encryptedArray.length - AES_CONFIG.tagLength / 8;
  const ciphertext = encryptedArray.slice(0, tagStart);
  const authTag = encryptedArray.slice(tagStart);

  return {
    ciphertext: uint8ArrayToBase64(ciphertext),
    iv: uint8ArrayToBase64(iv),
    authTag: uint8ArrayToBase64(authTag),
    version,
    updatedAt: new Date(),
  };
}

/**
 * Derives an AES-256-GCM CryptoKey from user credentials.
 * Standalone helper so encrypt/decrypt don't need a service instance.
 */
async function deriveKeyFromCredentials(credentials: UserCredentials): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const salt = encoder.encode(credentials.userId);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(credentials.passphrase) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: AES_CONFIG.algorithm, length: AES_CONFIG.keyLength },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Decrypts an EncryptedPreferences object back to a JSON string.
 */
export async function decryptPreferences(
  encrypted: EncryptedPreferences,
  key: CryptoKey
): Promise<string> {
  const decoder = new TextDecoder();
  const iv = base64ToUint8Array(encrypted.iv);
  const ciphertext = base64ToUint8Array(encrypted.ciphertext);
  const authTag = base64ToUint8Array(encrypted.authTag);

  // Combine ciphertext + authTag (Web Crypto expects them concatenated)
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    {
      name: AES_CONFIG.algorithm,
      iv: iv as BufferSource,
      tagLength: AES_CONFIG.tagLength,
    },
    key,
    combined as BufferSource
  );

  return decoder.decode(decrypted);
}

/** Type guard for Axios 404 errors */
function isAxios404(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as { response?: { status?: number } }).response === 'object' &&
    (error as { response: { status: number } }).response.status === 404
  );
}
