/**
 * Notification worker — consumes the 'notifications' queue and does the heavy
 * lifting (DB writes + FCM push). Runs inside the API process for simplicity,
 * but can be split into a separate process/container for bigger scale
 * (just run this file standalone).
 */
const { Worker, connection, enabled, QUEUE_NAMES } = require('../config/queue');
const { processNotify, processBroadcast } = require('../services/notification.service');
const logger = require('../utils/logger');

function startNotificationWorker() {
  if (!enabled) {
    logger.warn('⚠️  Notification worker not started (Redis/BullMQ unavailable) — using inline fallback.');
    return null;
  }
  const worker = new Worker(
    QUEUE_NAMES.NOTIFICATION,
    async (job) => {
      if (job.name === 'notify') return processNotify(job.data);
      if (job.name === 'broadcast') return processBroadcast(job.data);
    },
    { connection, concurrency: 10 } // process up to 10 jobs at once
  );

  worker.on('failed', (job, err) => logger.error(`notification job ${job?.id} failed: ${err.message}`));
  logger.info('📨 Notification worker started (concurrency 10)');
  return worker;
}

module.exports = { startNotificationWorker };
