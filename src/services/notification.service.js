/**
 * Notification service.
 *
 * Public API (notifyUser / broadcast) is FAST — it just enqueues a job and
 * returns, so request handlers never wait on DB writes or FCM under load.
 * A BullMQ worker (or an inline fallback in dev) runs the heavy work via
 * processNotify / processBroadcast.
 */
const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendPush } = require('../config/firebase');
const { enqueue, QUEUE_NAMES } = require('../config/queue');
const logger = require('../utils/logger');

/* ---------- heavy workers (run in the queue or inline) ---------- */

async function processNotify({ userId, title, body, type = 'system', data = {}, image }) {
  try {
    await Notification.create({ user: userId, title, body, type, data, image });
    const user = await User.findById(userId).select('fcmTokens notificationsEnabled');
    if (user && user.notificationsEnabled && user.fcmTokens?.length) {
      await sendPush(user.fcmTokens, { title, body, data: { ...data, type } });
    }
  } catch (err) {
    logger.error(`processNotify failed: ${err.message}`);
  }
}

async function processBroadcast({ filter = {}, title, body, type = 'promo', data = {}, image }) {
  try {
    // stream in batches so a huge audience doesn't blow up memory
    const users = await User.find({ ...filter, notificationsEnabled: true }).select('_id fcmTokens').lean();
    const BATCH = 500;
    for (let i = 0; i < users.length; i += BATCH) {
      const slice = users.slice(i, i + BATCH);
      await Notification.insertMany(slice.map((u) => ({ user: u._id, title, body, type, data, image })));
      const tokens = slice.flatMap((u) => u.fcmTokens || []);
      if (tokens.length) await sendPush(tokens, { title, body, data: { ...data, type } });
    }
    return { recipients: users.length };
  } catch (err) {
    logger.error(`processBroadcast failed: ${err.message}`);
    return { recipients: 0 };
  }
}

/* ---------- fast public API (enqueue) ---------- */

function notifyUser(userId, payload = {}) {
  // fire-and-forget; do not await in request handlers
  enqueue(QUEUE_NAMES.NOTIFICATION, 'notify', { userId, ...payload }, processNotify)
    .catch((err) => logger.error(`notifyUser enqueue: ${err.message}`));
}

/**
 * Broadcast. Returns an estimated recipient count immediately; the actual
 * sending happens in the background. (Admins get an approximate number.)
 */
async function broadcast({ filter = {}, title, body, type = 'promo', data = {}, image } = {}) {
  let recipients = 0;
  try { recipients = await User.countDocuments({ ...filter, notificationsEnabled: true }); } catch { /* ignore */ }
  enqueue(QUEUE_NAMES.NOTIFICATION, 'broadcast', { filter, title, body, type, data, image }, processBroadcast)
    .catch((err) => logger.error(`broadcast enqueue: ${err.message}`));
  return { recipients };
}

module.exports = { notifyUser, broadcast, processNotify, processBroadcast };
