/**
 * Unit tests for AES-256-GCM encryption wrapper.
 * Requirements: 13.2
 */

import { encrypt, decrypt, deriveEncryptionKey, uint8ArrayToBase64, base64ToUint8Array, AES_CONFIG } from '../encryption';

// Web Crypto API is available in Node 20+ via globalThis.crypto
describe('Encryption utilities', () => {
  describe('base64 encoding/decoding', () => {
    it('should round-trip Uint8Array through base64', () => {
      const original = new Uint8Array([0, 1, 127, 128, 255, 42, 99]);
      const encoded = uint8ArrayToBase64(original);
      const decoded = base64ToUint8Array(encoded);
      expect(decoded).toEqual(original);
    });

    it('should handle empty array', () => {
      const original = new Uint8Array(0);
      const encoded = uint8ArrayToBase64(original);
      const decoded = base64ToUint8Array(encoded);
      expect(decoded).toEqual(original);
    });
  });

  describe('AES-256-GCM encrypt/decrypt', () => {
    let key: Uint8Array;

    beforeAll(async () => {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      key = await deriveEncryptionKey('test-passphrase', salt);
    });

    it('should derive a 256-bit key', () => {
      expect(key.length).toBe(32); // 256 bits = 32 bytes
    });

    it('should encrypt and decrypt a string', async () => {
      const plaintext = 'Hello, encrypted world!';
      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext for same plaintext (random IV)', async () => {
      const plaintext = 'Same message twice';
      const enc1 = await encrypt(plaintext, key);
      const enc2 = await encrypt(plaintext, key);
      expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
      expect(enc1.iv).not.toBe(enc2.iv);
    });

    it('should fail to decrypt with wrong key', async () => {
      const plaintext = 'Secret data';
      const encrypted = await encrypt(plaintext, key);

      const wrongSalt = crypto.getRandomValues(new Uint8Array(16));
      const wrongKey = await deriveEncryptionKey('wrong-passphrase', wrongSalt);

      await expect(decrypt(encrypted, wrongKey)).rejects.toThrow();
    });

    it('should fail to decrypt with tampered ciphertext', async () => {
      const plaintext = 'Integrity check';
      const encrypted = await encrypt(plaintext, key);

      // Tamper with ciphertext
      const tampered = { ...encrypted, ciphertext: encrypted.ciphertext + 'A' };
      await expect(decrypt(tampered, key)).rejects.toThrow();
    });

    it('should handle empty string', async () => {
      const plaintext = '';
      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);
      expect(decrypted).toBe('');
    });

    it('should handle large payloads', async () => {
      const plaintext = 'x'.repeat(100000);
      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('should use correct IV length', async () => {
      const encrypted = await encrypt('test', key);
      const iv = base64ToUint8Array(encrypted.iv);
      expect(iv.length).toBe(AES_CONFIG.ivLength);
    });
  });
});
