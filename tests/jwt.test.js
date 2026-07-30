/**
 * Unit tests for JWT util.
 */
process.env.JWT_ACCESS_SECRET = 'test_access_secret_32_chars_minimum_ok';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_32_chars_minimum_ok';
const jwtUtil = require('../src/utils/jwt');

describe('jwt util', () => {
  const user = { _id: '507f1f77bcf86cd799439011', role: 'customer' };

  test('issues access + refresh tokens', () => {
    const t = jwtUtil.issueTokens(user);
    expect(t.accessToken).toBeTruthy();
    expect(t.refreshToken).toBeTruthy();
  });

  test('verifies a valid access token', () => {
    const { accessToken } = jwtUtil.issueTokens(user);
    const decoded = jwtUtil.verifyAccessToken(accessToken);
    expect(decoded.id).toBe(user._id);
    expect(decoded.role).toBe('customer');
  });

  test('rejects a tampered token', () => {
    const { accessToken } = jwtUtil.issueTokens(user);
    expect(() => jwtUtil.verifyAccessToken(accessToken + 'x')).toThrow();
  });
});
