/**
 * Firebase Admin for FCM push notifications.
 * Gracefully disabled if credentials are absent.
 */
const config = require('./env');
const logger = require('../utils/logger');

let admin = null;
const enabled = Boolean(config.firebase.projectId && config.firebase.privateKey && config.firebase.clientEmail);

if (enabled) {
  admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: config.firebase.projectId,
        privateKey: config.firebase.privateKey.replace(/\\n/g, '\n'),
        clientEmail: config.firebase.clientEmail,
      }),
    });
  }
} else {
  logger.warn('⚠️  Firebase not configured — push notifications will be logged only in dev.');
}

/**
 * Send a push notification to one or more device tokens.
 */
async function sendPush(tokens, { title, body, data = {} }) {
  const list = (Array.isArray(tokens) ? tokens : [tokens]).filter(Boolean);
  if (!list.length) return { sent: 0 };
  if (!enabled) {
    logger.info(`📲 [DEV] Push "${title}" to ${list.length} device(s): ${body}`);
    return { sent: list.length, mock: true };
  }
  const message = {
    notification: { title, body },
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    tokens: list,
  };
  const res = await admin.messaging().sendEachForMulticast(message);
  return { sent: res.successCount, failed: res.failureCount };
}

module.exports = { admin, enabled, sendPush };
