/**
 * Unit tests for UserPreferenceSyncService.
 * Tests E2E encrypted preference sync with AES-256-GCM.
 * Requirements: 5.6
 */

import {
  createPreferenceSyncService,
  encryptPreferences,
  decryptPreferences,
  UserPreferenceSyncService,
  UserCredentials,
} from '../preferenceSyncService';
import { EncryptedPreferences } from '../../types';
import { AES_CONFIG } from '../../db/encryption';

// Mock axios
jest.mock('axios', () => {
  const mockAxiosInstance = {
    get: jest.fn(),
    put: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
  return {
    create: jest.fn(() => mockAxiosInstance),
    __mockInstance: mockAxiosInstance,
  };
});

function getMockAxiosInstance() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('axios').__mockInstance;
}

/**
 * Derives an extractable CryptoKey for test comparison purposes.
 * The service's deriveEncryptionKey creates non-extractable keys (correct for production),
 * so this helper derives an equivalent key with extractable: true so tests can export
 * and compare raw key bytes.
 */
async function deriveExportableKey(credentials: UserCredentials): Promise<CryptoKey> {
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
    true, // extractable = true for test comparison
    ['encrypt', 'decrypt']
  );
}

describe('UserPreferenceSyncService', () => {
  let service: UserPreferenceSyncService;
  let mockGetAuthToken: jest.Mock;
  let mockGetLocalPreferences: jest.Mock;
  let mockSetLocalPreferences: jest.Mock;
  let mockGetLocalVersion: jest.Mock;

  const testCredentials: UserCredentials = {
    userId: 'user-123',
    passphrase: 'secure-passphrase-for-testing',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthToken = jest.fn().mockResolvedValue('test-jwt-token');
    mockGetLocalPreferences = jest.fn().mockResolvedValue(
      JSON.stringify({ visibility: { 'cal-1': 'private', 'cal-2': 'public' } })
    );
    mockSetLocalPreferences = jest.fn().mockResolvedValue(undefined);
    mockGetLocalVersion = jest.fn().mockResolvedValue(1);

    service = createPreferenceSyncService(
      'https://api.example.com',
      mockGetAuthToken,
      testCredentials,
      mockGetLocalPreferences,
      mockSetLocalPreferences,
      mockGetLocalVersion
    );
  });

  describe('deriveEncryptionKey', () => {
    it('derives a CryptoKey from user credentials', async () => {
      const key = await service.deriveEncryptionKey(testCredentials);
      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
      expect(key.usages).toContain('encrypt');
      expect(key.usages).toContain('decrypt');
    });

    it('derives the same key for the same credentials', async () => {
      const raw1 = await crypto.subtle.exportKey('raw', await deriveExportableKey(testCredentials));
      const raw2 = await crypto.subtle.exportKey('raw', await deriveExportableKey(testCredentials));
      expect(Buffer.from(raw1).toString('hex')).toBe(Buffer.from(raw2).toString('hex'));
    });

    it('derives different keys for different passphrases', async () => {
      const creds1: UserCredentials = { userId: 'user-1', passphrase: 'pass-a' };
      const creds2: UserCredentials = { userId: 'user-1', passphrase: 'pass-b' };

      const raw1 = await crypto.subtle.exportKey('raw', await deriveExportableKey(creds1));
      const raw2 = await crypto.subtle.exportKey('raw', await deriveExportableKey(creds2));
      expect(Buffer.from(raw1).toString('hex')).not.toBe(Buffer.from(raw2).toString('hex'));
    });

    it('derives different keys for different userIds (salt)', async () => {
      const creds1: UserCredentials = { userId: 'user-a', passphrase: 'same-pass' };
      const creds2: UserCredentials = { userId: 'user-b', passphrase: 'same-pass' };

      const raw1 = await crypto.subtle.exportKey('raw', await deriveExportableKey(creds1));
      const raw2 = await crypto.subtle.exportKey('raw', await deriveExportableKey(creds2));
      expect(Buffer.from(raw1).toString('hex')).not.toBe(Buffer.from(raw2).toString('hex'));
    });
  });

  describe('encryptPreferences / decryptPreferences round-trip', () => {
    it('encrypts and decrypts preferences back to original JSON', async () => {
      const originalJson = JSON.stringify({ visibility: { 'cal-1': 'private' }, theme: 'dark' });
      const encrypted = await encryptPreferences(originalJson, testCredentials, 5);

      const key = await service.deriveEncryptionKey(testCredentials);
      const decrypted = await decryptPreferences(encrypted, key);

      expect(decrypted).toBe(originalJson);
    });

    it('encrypted output has correct version and non-empty fields', async () => {
      const json = JSON.stringify({ foo: 'bar' });
      const encrypted = await encryptPreferences(json, testCredentials, 3);

      expect(encrypted.version).toBe(3);
      expect(encrypted.ciphertext).toBeTruthy();
      expect(encrypted.iv).toBeTruthy();
      expect(encrypted.authTag).toBeTruthy();
      expect(encrypted.updatedAt).toBeInstanceOf(Date);
    });

    it('produces different ciphertext for the same plaintext (random IV)', async () => {
      const json = JSON.stringify({ same: 'data' });
      const enc1 = await encryptPreferences(json, testCredentials, 1);
      const enc2 = await encryptPreferences(json, testCredentials, 1);

      // IVs should differ (random), so ciphertext should differ
      expect(enc1.iv).not.toBe(enc2.iv);
    });

    it('decryption fails with wrong credentials', async () => {
      const json = JSON.stringify({ secret: 'value' });
      const encrypted = await encryptPreferences(json, testCredentials, 1);

      const wrongCreds: UserCredentials = { userId: 'user-123', passphrase: 'wrong-passphrase' };
      const wrongKey = await deriveExportableKey(wrongCreds);

      await expect(decryptPreferences(encrypted, wrongKey)).rejects.toThrow();
    });
  });

  describe('pushPreferences', () => {
    it('calls PUT with correct payload', async () => {
      const mockAxios = getMockAxiosInstance();
      mockAxios.put.mockResolvedValue({ status: 200 });

      const prefs: EncryptedPreferences = {
        ciphertext: 'encrypted-data',
        iv: 'test-iv',
        authTag: 'test-tag',
        version: 2,
        updatedAt: new Date('2025-01-15T00:00:00Z'),
      };

      await service.pushPreferences('user-123', prefs);

      expect(mockAxios.put).toHaveBeenCalledWith('/preferences/user-123', {
        ciphertext: 'encrypted-data',
        iv: 'test-iv',
        authTag: 'test-tag',
        version: 2,
      });
    });
  });

  describe('pullPreferences', () => {
    it('calls GET and returns correct shape', async () => {
      const mockAxios = getMockAxiosInstance();
      mockAxios.get.mockResolvedValue({
        data: {
          ciphertext: 'remote-cipher',
          iv: 'remote-iv',
          authTag: 'remote-tag',
          version: 5,
          updatedAt: '2025-01-15T12:00:00Z',
        },
      });

      const result = await service.pullPreferences('user-123');

      expect(mockAxios.get).toHaveBeenCalledWith('/preferences/user-123');
      expect(result.ciphertext).toBe('remote-cipher');
      expect(result.iv).toBe('remote-iv');
      expect(result.authTag).toBe('remote-tag');
      expect(result.version).toBe(5);
      expect(result.updatedAt).toEqual(new Date('2025-01-15T12:00:00Z'));
    });
  });

  describe('syncPreferences', () => {
    it('when remote version > local version, decrypts remote and calls setLocalPreferences', async () => {
      const localJson = JSON.stringify({ visibility: { 'cal-1': 'public' } });
      const encrypted = await encryptPreferences(localJson, testCredentials, 3);

      const mockAxios = getMockAxiosInstance();
      mockAxios.get.mockResolvedValue({
        data: {
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          version: 3,
          updatedAt: '2025-01-15T12:00:00Z',
        },
      });

      // Local version is 1, remote is 3 → remote wins
      mockGetLocalVersion.mockResolvedValue(1);

      await service.syncPreferences('user-123');

      expect(mockSetLocalPreferences).toHaveBeenCalledWith('user-123', localJson);
      expect(mockAxios.put).not.toHaveBeenCalled();
    });

    it('when local version > remote version, encrypts local and pushes', async () => {
      const mockAxios = getMockAxiosInstance();
      mockAxios.get.mockResolvedValue({
        data: {
          ciphertext: 'old-cipher',
          iv: 'old-iv',
          authTag: 'old-tag',
          version: 1,
          updatedAt: '2025-01-10T00:00:00Z',
        },
      });
      mockAxios.put.mockResolvedValue({ status: 200 });

      // Local version is 5, remote is 1 → local wins
      mockGetLocalVersion.mockResolvedValue(5);
      mockGetLocalPreferences.mockResolvedValue(JSON.stringify({ theme: 'dark' }));

      await service.syncPreferences('user-123');

      expect(mockSetLocalPreferences).not.toHaveBeenCalled();
      expect(mockAxios.put).toHaveBeenCalledTimes(1);
      const putPayload = mockAxios.put.mock.calls[0][1];
      expect(putPayload.version).toBe(5);
      expect(putPayload.ciphertext).toBeTruthy();
      expect(putPayload.iv).toBeTruthy();
      expect(putPayload.authTag).toBeTruthy();
    });

    it('when versions are equal, does not call setLocalPreferences or pushPreferences', async () => {
      const mockAxios = getMockAxiosInstance();
      mockAxios.get.mockResolvedValue({
        data: {
          ciphertext: 'cipher',
          iv: 'iv',
          authTag: 'tag',
          version: 3,
          updatedAt: '2025-01-15T00:00:00Z',
        },
      });

      // Both versions are 3 → no sync needed
      mockGetLocalVersion.mockResolvedValue(3);

      await service.syncPreferences('user-123');

      expect(mockSetLocalPreferences).not.toHaveBeenCalled();
      expect(mockAxios.put).not.toHaveBeenCalled();
    });

    it('when pull returns 404, encrypts local and pushes (first-time sync)', async () => {
      const mockAxios = getMockAxiosInstance();
      const error404 = { response: { status: 404 } };
      mockAxios.get.mockRejectedValue(error404);
      mockAxios.put.mockResolvedValue({ status: 200 });

      mockGetLocalVersion.mockResolvedValue(1);
      mockGetLocalPreferences.mockResolvedValue(JSON.stringify({ newUser: true }));

      await service.syncPreferences('user-123');

      expect(mockSetLocalPreferences).not.toHaveBeenCalled();
      expect(mockAxios.put).toHaveBeenCalledTimes(1);
      const putPayload = mockAxios.put.mock.calls[0][1];
      expect(putPayload.version).toBe(1);
      expect(putPayload.ciphertext).toBeTruthy();
    });

    it('rethrows non-404 errors', async () => {
      const mockAxios = getMockAxiosInstance();
      const error500 = { response: { status: 500 }, message: 'Internal Server Error' };
      mockAxios.get.mockRejectedValue(error500);

      await expect(service.syncPreferences('user-123')).rejects.toEqual(error500);
      expect(mockAxios.put).not.toHaveBeenCalled();
      expect(mockSetLocalPreferences).not.toHaveBeenCalled();
    });
  });
});
