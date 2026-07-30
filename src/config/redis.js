/**
 * Redis client — used for OTP storage, rate limiting, and refresh-token
 * blacklisting. Falls back gracefully if Redis is unavailable in dev.
 */
const { createClient } = require('redis');
const config = require('./env');
const logger = require('../utils/logger');

const client = createClient({
  url: config.redisUrl,
  socket: {
    // Don't retry forever in dev when Redis isn't running — one attempt,
    // then fall back to the in-memory store below. (In prod with a real
    // REDIS_URL this still connects normally on the first try.)
    reconnectStrategy: () => false,
  },
});

let connected = false;
let errorLogged = false;

// Only log the FIRST error, then stay quiet — avoids flooding the console
// with "Redis error" every retry when Redis simply isn't running in dev.
client.on('error', (err) => {
  if (!errorLogged) {
    errorLogged = true;
    logger.warn(`⚠️  Redis unavailable (${err.message || 'connection refused'}). Using in-memory fallback for OTP/sessions in dev.`);
  }
});
client.on('connect', () => {
  connected = true;
  logger.info('✅ Redis connected');
});

async function connectRedis() {
  try {
    await client.connect();
    connected = true;
  } catch (err) {
    if (!errorLogged) {
      errorLogged = true;
      logger.warn(`⚠️  Redis unavailable (${err.message}). OTP/session features will use in-memory fallback in dev.`);
    }
  }
}

// Simple in-memory fallback so the app runs in dev without Redis.
const memStore = new Map();

const store = {
  async set(key, value, ttlSeconds) {
    if (connected) {
      await client.set(key, value, { EX: ttlSeconds });
    } else {
      memStore.set(key, value);
      if (ttlSeconds) setTimeout(() => memStore.delete(key), ttlSeconds * 1000);
    }
  },
  async get(key) {
    return connected ? client.get(key) : memStore.get(key) ?? null;
  },
  async del(key) {
    if (connected) await client.del(key);
    else memStore.delete(key);
  },
  async incr(key, ttlSeconds) {
    if (connected) {
      const n = await client.incr(key);
      if (n === 1 && ttlSeconds) await client.expire(key, ttlSeconds);
      return n;
    }
    const n = (memStore.get(key) || 0) + 1;
    memStore.set(key, n);
    if (n === 1 && ttlSeconds) setTimeout(() => memStore.delete(key), ttlSeconds * 1000);
    return n;
  },
};

function isRedisConnected() {
  return connected;
}

module.exports = { client, connectRedis, store, isRedisConnected };
