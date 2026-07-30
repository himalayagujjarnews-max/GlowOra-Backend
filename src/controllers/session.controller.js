/**
 * Session controller — list active devices, revoke one or all.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const sessionService = require('../services/session.service');
const LoginHistory = require('../models/LoginHistory');
const Session = require('../models/Session');
const { getPagination, buildMeta } = require('../utils/pagination');

// GET /sessions  — active sessions/devices
exports.list = asyncHandler(async (req, res) => {
  const sessions = await sessionService.listSessions(req.user._id);
  const currentSid = req.user.sid;
  const out = sessions.map((s) => ({
    id: s._id,
    device: s.device,
    ip: s.ip,
    location: s.location,
    lastUsedAt: s.lastUsedAt,
    current: currentSid && s._id.toString() === currentSid,
  }));
  sendResponse(res, 200, 'Active sessions', { sessions: out });
});

// DELETE /sessions/:id  — revoke one device
exports.revoke = asyncHandler(async (req, res) => {
  const session = await Session.findOne({ _id: req.params.id, user: req.user._id });
  if (!session) throw ApiError.notFound('Session not found');
  await sessionService.revoke(session._id, 'user_revoked');
  sendResponse(res, 200, 'Device logged out');
});

// DELETE /sessions  — log out everywhere (optionally keep current)
exports.revokeAll = asyncHandler(async (req, res) => {
  const keepCurrent = req.query.keepCurrent === 'true';
  await sessionService.revokeAll(req.user._id, keepCurrent ? req.user.sid : null, 'user_revoked_all');
  sendResponse(res, 200, keepCurrent ? 'Logged out of all other devices' : 'Logged out everywhere');
});

// GET /sessions/login-history
exports.loginHistory = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const [items, total] = await Promise.all([
    LoginHistory.find({ user: req.user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    LoginHistory.countDocuments({ user: req.user._id }),
  ]);
  sendResponse(res, 200, 'Login history', { history: items }, buildMeta(page, limit, total));
});
