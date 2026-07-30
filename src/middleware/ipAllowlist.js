/**
 * Admin IP allowlist — if ADMIN_IP_ALLOWLIST is configured, only those IPs
 * may hit admin routes. Empty allowlist = allow all (dev-friendly).
 */
const config = require('../config/env');
const ApiError = require('../utils/ApiError');

module.exports = function adminIpAllowlist(req, res, next) {
  const list = config.security.adminIpAllowlist;
  if (!list.length) return next();
  const ip = (req.ip || '').replace('::ffff:', '');
  if (list.includes(ip)) return next();
  return next(ApiError.forbidden('Access to admin from this network is not permitted.'));
};
