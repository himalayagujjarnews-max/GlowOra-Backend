/**
 * Audit middleware — records every mutating request (POST/PATCH/PUT/DELETE)
 * to the immutable AuditLog after the response is sent. Sensitive fields
 * are redacted so secrets never land in the log.
 */
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

const REDACT = ['password', 'otp', 'token', 'twoFactorCode', 'refreshToken', 'razorpaySignature', 'accountNumber', 'panNumber', 'secret'];

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT.includes(k)) out[k] = '***';
    else if (typeof v === 'object' && v !== null) out[k] = redact(v);
    else out[k] = v;
  }
  return out;
}

const AUDIT_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

module.exports = function audit(req, res, next) {
  if (!AUDIT_METHODS.has(req.method)) return next();

  res.on('finish', () => {
    // don't block the request; fire-and-forget
    const entry = {
      actor: req.user ? req.user._id : undefined,
      actorRole: req.user ? req.user.role : undefined,
      action: `${req.method} ${req.baseUrl || ''}${req.route ? req.route.path : req.path}`.trim(),
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.id,
      meta: { body: redact(req.body), params: req.params, query: req.query },
      success: res.statusCode < 400,
    };
    AuditLog.create(entry).catch((err) => logger.error(`audit log failed: ${err.message}`));
  });

  next();
};
