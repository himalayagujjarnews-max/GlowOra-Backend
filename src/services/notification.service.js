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

// Notification `type` (see models/Notification.js enum) → the notificationPrefs
// category the user toggles in Settings. booking/payment/review are all
// "booking-related" from the customer's point of view, so they share one pref.
const TYPE_TO_PREF = {
  booking: 'bookings', payment: 'bookings', review: 'bookings',
  promo: 'offers', chat: 'chat', system: 'system',
};

/* ---------- heavy workers (run in the queue or inline) ---------- */

async function processNotify({ userId, title, body, type = 'system', data = {}, image }) {
  try {
    await Notification.create({ user: userId, title, body, type, data, image });
    const user = await User.findById(userId).select('fcmTokens notificationsEnabled notificationPrefs');
    const prefKey = TYPE_TO_PREF[type] || 'system';
    // undefined prefs (older accounts) default to allowed — only an explicit false mutes it
    const categoryAllowed = user?.notificationPrefs?.[prefKey] !== false;
    if (user && user.notificationsEnabled && categoryAllowed && user.fcmTokens?.length) {
      await sendPush(user.fcmTokens, { title, body, data: { ...data, type } });
    }
  } catch (err) {
    logger.error(`processNotify failed: ${err.message}`);
  }
}

async function processBroadcast({ filter = {}, title, body, type = 'promo', data = {}, image }) {
  try {
    const prefKey = TYPE_TO_PREF[type] || 'system';
    // stream in batches so a huge audience doesn't blow up memory
    const users = await User.find({ ...filter, notificationsEnabled: true }).select('_id fcmTokens notificationPrefs').lean();
    const BATCH = 500;
    for (let i = 0; i < users.length; i += BATCH) {
      const slice = users.slice(i, i + BATCH);
      // in-app feed still gets the item for everyone matching the filter —
      // only the push send is muted for users who turned this category off
      await Notification.insertMany(slice.map((u) => ({ user: u._id, title, body, type, data, image })));
      const tokens = slice.filter((u) => u.notificationPrefs?.[prefKey] !== false).flatMap((u) => u.fcmTokens || []);
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
