/**
 * Unit tests for TOTP 2FA.
 */
const totp = require('../src/utils/totp');

describe('totp util', () => {
  test('generates a base32 secret', () => {
    const s = totp.generateSecret();
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(20);
    expect(/^[A-Z2-7]+$/.test(s)).toBe(true);
  });

  test('generated token verifies against its secret', () => {
    const secret = totp.generateSecret();
    const token = totp.generateToken(secret);
    expect(token).toHaveLength(6);
    expect(totp.verifyToken(secret, token)).toBe(true);
  });

  test('wrong token does not verify', () => {
    const secret = totp.generateSecret();
    expect(totp.verifyToken(secret, '000000')).toBe(false);
  });

  test('otpauth url is well-formed', () => {
    const url = totp.otpauthUrl('ABCDEF', '9999999999', 'GlowOra');
    expect(url).toContain('otpauth://totp/');
    expect(url).toContain('secret=ABCDEF');
    expect(url).toContain('issuer=GlowOra');
  });

  test('backup codes are unique and formatted', () => {
    const codes = totp.generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
  });
});
