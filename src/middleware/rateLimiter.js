/**
 * Rate limiters for sensitive endpoints.
 *
 * Store: uses Redis (shared across all instances) when available, so limits
 * are enforced correctly behind a load balancer / PM2 cluster / multiple
 * containers. Falls back to the default in-memory store when Redis isn't
 * connected (e.g. local dev without Redis running) — same graceful-degrade
 * pattern used elsewhere in this codebase (see src/config/redis.js).
 */
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { client: redisClient, isRedisConnected } = require('../config/redis');

// express-rate-limit checks store.init()/increment() lazily per request, so we
// can pass a store that only delegates to Redis once it's actually connected.
function redisStoreIfAvailable() {
  return {
    // Lazily build the store on first use so we pick up the connection state
    // set at startup (connectRedis() runs before the server starts listening).
    init(options) {
      if (isRedisConnected()) {
        this._store = new RedisStore({
          sendCommand: (...args) => redisClient.sendCommand(args),
        });
        this._store.init && this._store.init(options);
      }
    },
    async increment(key) {
      if (this._store) return this._store.increment(key);
      // in-memory fallback: simple per-process counter, mirrors express-rate-limit's own default behavior
      this._mem = this._mem || new Map();
      const entry = this._mem.get(key) || { totalHits: 0, resetTime: new Date(Date.now() + 15 * 60 * 1000) };
      entry.totalHits += 1;
      this._mem.set(key, entry);
      return entry;
    },
    async decrement(key) {
      if (this._store) return this._store.decrement(key);
    },
    async resetKey(key) {
      if (this._store) return this._store.resetKey(key);
      this._mem && this._mem.delete(key);
    },
  };
}

// General API limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStoreIfAvailable(),
  message: { success: false, message: 'Too many requests. Please try again later.' },
});

// Strict limiter for OTP / auth
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStoreIfAvailable(),
  message: { success: false, message: 'Too many attempts. Please wait before trying again.' },
});

module.exports = { apiLimiter, authLimiter };
