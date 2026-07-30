/**
 * Attaches a unique request id to every request for tracing across logs,
 * audit entries, and error responses. Honours an inbound X-Request-Id.
 */
const crypto = require('crypto');

module.exports = function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
