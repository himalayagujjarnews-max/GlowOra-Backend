/**
 * Agora RTC token generation for in-app voice/video calls.
 * Numbers stay private — customer and staff join a channel, not a phone call.
 */
const config = require('./env');
const logger = require('../utils/logger');

const enabled = Boolean(config.agora.appId && config.agora.appCertificate);
if (!enabled) logger.warn('⚠️  Agora not configured — call tokens will be mocked in dev.');

/**
 * Build an RTC token for a channel + uid, valid for `expireSeconds`.
 */
function buildRtcToken(channelName, uid, role = 'publisher', expireSeconds = 3600) {
  if (!enabled) {
    return { appId: 'mock-app-id', channel: channelName, uid, token: `mock_token_${Date.now()}`, expiresIn: expireSeconds, mock: true };
  }
  // agora-token package
  const { RtcTokenBuilder, RtcRole } = require('agora-token');
  const rtcRole = role === 'subscriber' ? RtcRole.SUBSCRIBER : RtcRole.PUBLISHER;
  const now = Math.floor(Date.now() / 1000);
  const privilegeExpire = now + expireSeconds;
  const token = RtcTokenBuilder.buildTokenWithUid(
    config.agora.appId,
    config.agora.appCertificate,
    channelName,
    uid,
    rtcRole,
    privilegeExpire,
    privilegeExpire
  );
  return { appId: config.agora.appId, channel: channelName, uid, token, expiresIn: expireSeconds };
}

module.exports = { buildRtcToken, enabled };
