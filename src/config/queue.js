/**
 * BullMQ queues — offload slow work (push/email/SMS, broadcasts) from the
 * request path so APIs stay fast under heavy load.
 *
 * Falls back to running jobs inline if Redis is unavailable (dev), so the
 * app keeps working without a queue in local development.
 */
const config = require('./env');
const logger = require('../utils/logger');

let Queue, Worker, connection;
let enabled = false;

// Only turn the queue ON when Redis is explicitly configured (managed Redis
// in prod/staging). In local dev, if REDIS_URL isn't set we skip BullMQ and
// run jobs inline — otherwise BullMQ would hang trying to reach a Redis that
// isn't running.
if (process.env.REDIS_URL) {
  try {
    // BullMQ needs a real Redis connection (ioredis-style options)
    const { Queue: Q, Worker: W } = require('bullmq');
    Queue = Q;
    Worker = W;
    const url = new URL(config.redisUrl);
    connection = {
      host: url.hostname,
      port: Number(url.port) || 6379,
      password: url.password || undefined,
      maxRetriesPerRequest: null,
    };
    enabled = true;
  } catch (err) {
    logger.warn(`⚠️  BullMQ not available (${err.message}) — jobs will run inline.`);
  }
} else {
  logger.info('ℹ️  No REDIS_URL set — background jobs run inline (fine for dev).');
}

const QUEUE_NAMES = { NOTIFICATION: 'notifications' };

// lazily-created singleton queues
const queues = {};
function getQueue(name) {
  if (!enabled) return null;
  if (!queues[name]) {
    try {
      queues[name] = new Queue(name, { connection, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 } });
    } catch (err) {
      logger.error(`queue init failed: ${err.message}`);
      return null;
    }
  }
  return queues[name];
}

/**
 * Add a job. If the queue isn't available, run the inline fallback so the
 * work still happens in dev.
 */
async function enqueue(name, jobName, data, inlineFallback) {
  const q = getQueue(name);
  if (q) {
    try {
      await q.add(jobName, data);
      return { queued: true };
    } catch (err) {
      logger.error(`enqueue failed: ${err.message}`);
    }
  }
  if (inlineFallback) await inlineFallback(data);
  return { queued: false };
}

module.exports = { Queue, Worker, connection, enabled, QUEUE_NAMES, getQueue, enqueue };
