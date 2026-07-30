/**
 * Unit tests for AES-256-GCM field encryption.
 */
process.env.ENCRYPTION_KEY = 'a3f7c9e21b8d4f6a0c5e9d2b7a1f8e3c4d6b9a0e5f2c8d1b7a4e6c3f9b0d2e8a';
const { encrypt, decrypt, blindIndex, sha256, randomToken } = require('../src/utils/encryption');

describe('encryption util', () => {
  test('encrypts and decrypts round-trip', () => {
    const secret = '1234567890123456';
    const enc = encrypt(secret);
    expect(enc).not.toBe(secret);
    expect(enc.split(':')).toHaveLength(3);
    expect(decrypt(enc)).toBe(secret);
  });

  test('produces different ciphertext each time (random IV)', () => {
    expect(encrypt('hello')).not.toBe(encrypt('hello'));
  });

  test('tampered ciphertext fails to decrypt (auth tag)', () => {
    const enc = encrypt('sensitive');
    const tampered = enc.slice(0, -2) + 'ff';
    expect(decrypt(tampered)).toBeNull();
  });

  test('passes through empty/null values', () => {
    expect(encrypt('')).toBe('');
    expect(decrypt(null)).toBeNull();
  });

  test('blindIndex is deterministic, sha256 works, randomToken is unique', () => {
    expect(blindIndex('9999999999')).toBe(blindIndex('9999999999'));
    expect(sha256('abc')).toHaveLength(64);
    expect(randomToken(16)).not.toBe(randomToken(16));
  });
});
