/**
 * Session service — issues access+refresh tokens backed by a DB Session
 * record, with refresh-token rotation and reuse detection.
 *
 * Security model:
 *  - Each login creates a Session with a random tokenFamily.
 *  - The refresh token is `${sessionId}.${rawSecret}`; only sha256(raw) is stored.
 *  - On refresh, the old token is rotated to a new one within the same family.
 *  - If a token that was already rotated (or revoked) is presented, we treat
 *    it as theft and revoke the entire family.
 */
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { sha256, randomToken } = require('../utils/encryption');
const Session = require('../models/Session');
const config = require('../config/env');

function parseUA(userAgent = '') {
  // lightweight device label
  let device = 'Unknown device';
  if (/iPhone/.test(userAgent)) device = 'iPhone';
  else if (/iPad/.test(userAgent)) device = 'iPad';
  else if (/Android/.test(userAgent)) device = 'Android';
  else if (/Windows/.test(userAgent)) device = 'Windows PC';
  else if (/Macintosh/.test(userAgent)) device = 'Mac';
  else if (/Linux/.test(userAgent)) device = 'Linux';
  return device;
}

function refreshExpiryDate() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
}

/** Create a new session + token pair for a login. */
async function createSession(user, { ip, userAgent } = {}) {
  const family = randomToken(16);
  const raw = randomToken(32);

  // enforce max sessions per user (revoke oldest)
  const active = await Session.find({ user: user._id, revoked: false }).sort({ lastUsedAt: 1 });
  if (active.length >= config.security.maxSessionsPerUser) {
    const excess = active.slice(0, active.length - config.security.maxSessionsPerUser + 1);
    await Session.updateMany({ _id: { $in: excess.map((s) => s._id) } }, { revoked: true, revokedReason: 'max_sessions' });
  }

  const session = await Session.create({
    user: user._id,
    tokenHash: sha256(raw),
    tokenFamily: family,
    device: parseUA(userAgent),
    userAgent,
    ip,
    expiresAt: refreshExpiryDate(),
  });

  const payload = { id: user._id.toString(), role: user.role, sid: session._id.toString() };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: `${session._id.toString()}.${raw}`,
    sessionId: session._id.toString(),
  };
}

/** Rotate a refresh token. Throws on invalid/reused tokens. */
async function rotate(refreshToken, { ip, userAgent } = {}) {
  if (!refreshToken || !refreshToken.includes('.')) {
    const e = new Error('Invalid refresh token'); e.code = 'INVALID'; throw e;
  }
  const [sessionId, raw] = refreshToken.split('.');
  const session = await Session.findById(sessionId).populate('user', 'role active');
  if (!session) { const e = new Error('Session not found'); e.code = 'INVALID'; throw e; }

  // reuse / theft detection: token doesn't match the current hash
  if (session.tokenHash !== sha256(raw)) {
    await Session.updateMany({ tokenFamily: session.tokenFamily }, { revoked: true, revokedReason: 'reuse_detected' });
    const e = new Error('Refresh token reuse detected — all sessions revoked'); e.code = 'REUSE'; throw e;
  }
  if (session.revoked) { const e = new Error('Session revoked'); e.code = 'REVOKED'; throw e; }
  if (session.expiresAt < new Date()) { const e = new Error('Session expired'); e.code = 'EXPIRED'; throw e; }
  if (!session.user || session.user.active === false) { const e = new Error('User inactive'); e.code = 'INACTIVE'; throw e; }

  // rotate
  const newRaw = randomToken(32);
  session.tokenHash = sha256(newRaw);
  session.lastUsedAt = new Date();
  session.expiresAt = refreshExpiryDate();
  if (ip) session.ip = ip;
  if (userAgent) session.device = parseUA(userAgent);
  await session.save();

  const payload = { id: session.user._id.toString(), role: session.user.role, sid: session._id.toString() };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: `${session._id.toString()}.${newRaw}`,
  };
}

async function revoke(sessionId, reason = 'logout') {
  await Session.findByIdAndUpdate(sessionId, { revoked: true, revokedReason: reason });
}

async function revokeAll(userId, exceptSessionId = null, reason = 'logout_all') {
  const filter = { user: userId, revoked: false };
  if (exceptSessionId) filter._id = { $ne: exceptSessionId };
  await Session.updateMany(filter, { revoked: true, revokedReason: reason });
}

async function listSessions(userId) {
  return Session.find({ user: userId, revoked: false }).sort({ lastUsedAt: -1 });
}

module.exports = { createSession, rotate, revoke, revokeAll, listSessions, parseUA };
