/**
 * Idempotency middleware — prevents duplicate side effects (double payments,
 * double orders) when a client retries. Client sends `Idempotency-Key`.
 *
 * Behaviour:
 *  - First request with a key: marked 'processing', then response cached.
 *  - Retry with same key + same body: cached response replayed.
 *  - Retry with same key + different body: 422 (key reuse).
 *  - Concurrent retry while processing: 409.
 */
const crypto = require('crypto');
const IdempotencyKey = require('../models/IdempotencyKey');
const ApiError = require('../utils/ApiError');

module.exports = function idempotency(req, res, next) {
  const key = req.headers['idempotency-key'];
  if (!key) return next(); // optional; only enforced when provided

  const requestHash = crypto.createHash('sha256')
    .update(JSON.stringify(req.body || {}) + req.originalUrl)
    .digest('hex');

  IdempotencyKey.findOne({ key })
    .then(async (existing) => {
      if (existing) {
        if (existing.requestHash !== requestHash) {
          return next(ApiError.badRequest('Idempotency-Key reused with a different request'));
        }
        if (existing.status === 'processing') {
          return next(new ApiError(409, 'A request with this Idempotency-Key is still processing'));
        }
        return res.status(existing.statusCode || 200).json(existing.response);
      }

      // create a processing record
      let record;
      try {
        record = await IdempotencyKey.create({
          key, user: req.user ? req.user._id : undefined,
          method: req.method, path: req.originalUrl, requestHash, status: 'processing',
        });
      } catch (err) {
        if (err.code === 11000) return next(new ApiError(409, 'Duplicate request in progress'));
        return next(err);
      }

      // capture the response body
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        IdempotencyKey.findByIdAndUpdate(record._id, {
          status: 'completed', statusCode: res.statusCode, response: body,
        }).catch(() => {});
        return originalJson(body);
      };
      next();
    })
    .catch(next);
};
