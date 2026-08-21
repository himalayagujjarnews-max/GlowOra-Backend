/**
 * OTP generation, storage (Redis), and SMS sending.
 *
 * SMS (phone) OTP delivery priority: Twilio Verify > MSG91 > dev console-log.
 * Twilio Verify manages the code's generation/storage/expiry/rate-limiting
 * on Twilio's side, so when Twilio is configured we skip our own
 * generateOtp()/saveOtp() for phone numbers entirely and just ask Twilio to
 * start/check a verification. Email OTP (see controllers/auth.controller.js
 * sendEmailOtp/verifyEmail) always uses the local Redis-backed flow below,
 * since Twilio Verify only does SMS/voice/WhatsApp, not email.
 */
const crypto = require('crypto');
const axios = require('axios');
const config = require('../config/env');
const { store } = require('../config/redis');
const logger = require('./logger');

const otpKey = (key) => `otp:${key}`;
const attemptKey = (key) => `otp_attempts:${key}`;
const cooldownKey = (key) => `otp_cooldown:${key}`;

const twilioEnabled = Boolean(
  config.twilio.accountSid && config.twilio.authToken && config.twilio.verifyServiceSid
);
let twilioClient = null;
if (twilioEnabled) {
  try {
    twilioClient = require('twilio')(config.twilio.accountSid, config.twilio.authToken);
  } catch (e) {
    logger.error(`Twilio SDK failed to load — falling back to MSG91/dev OTP: ${e.message}`);
  }
}

function generateOtp() {
  // cryptographically-random N-digit code
  const max = 10 ** config.otp.length;
  const num = crypto.randomInt(0, max);
  return num.toString().padStart(config.otp.length, '0');
}

async function isOnCooldown(key) {
  return (await store.get(cooldownKey(key))) !== null;
}

async function saveOtp(key, otp) {
  await store.set(otpKey(key), otp, config.otp.ttlSeconds);
  await store.set(cooldownKey(key), '1', config.otp.resendCooldownSeconds);
  await store.del(attemptKey(key));
}

// Send an SMS OTP to a 10-digit Indian mobile number. `otp` is only used by
// the MSG91/dev fallback paths — Twilio Verify generates its own code and
// ignores it.
async function sendSms(phone, otp) {
  if (twilioClient) {
    await twilioClient.verify.v2
      .services(config.twilio.verifyServiceSid)
      .verifications.create({ to: `+91${phone}`, channel: 'sms' });
    // still set a short cooldown lock locally so /send-otp respects the same
    // resend-cooldown UX as the other providers (Twilio has its own internal
    // rate limits too, but this keeps our API responses consistent)
    await store.set(cooldownKey(phone), '1', config.otp.resendCooldownSeconds);
    return { twilio: true };
  }
  if (!config.msg91.apiKey) {
    // Use console.log directly so it ALWAYS shows, regardless of log level/format.
    console.log('\n============================================');
    console.log(`  📩  DEV OTP for ${phone}  =  ${otp}`);
    console.log('============================================\n');
    logger.info(`📩 [DEV] OTP for ${phone} is ${otp} (Twilio/MSG91 not configured)`);
    return { dev: true };
  }
  // MSG91 OTP endpoint
  const url = 'https://control.msg91.com/api/v5/otp';
  const { data } = await axios.post(
    url,
    { template_id: config.msg91.templateId, mobile: `91${phone}`, otp },
    { headers: { authkey: config.msg91.apiKey } }
  );
  return data;
}

// Verify a submitted code. For phone numbers when Twilio is configured, this
// checks against Twilio Verify's servers instead of our local Redis store.
async function verifyOtp(key, submitted, { isPhone = false } = {}) {
  if (isPhone && twilioClient) {
    const attempts = await store.incr(attemptKey(key), config.otp.ttlSeconds);
    if (attempts > config.otp.maxAttempts) {
      return { ok: false, reason: 'too_many_attempts' };
    }
    try {
      const check = await twilioClient.verify.v2
        .services(config.twilio.verifyServiceSid)
        .verificationChecks.create({ to: `+91${key}`, code: submitted });
      if (check.status === 'approved') {
        await store.del(attemptKey(key));
        return { ok: true };
      }
      return { ok: false, reason: 'invalid' };
    } catch (e) {
      // Twilio throws (rather than returning a status) for an expired/not-found
      // verification — e.g. code already used, or the 10-minute window passed.
      if (e.status === 404 || e.code === 20404) return { ok: false, reason: 'expired' };
      logger.error(`Twilio verification check failed: ${e.message}`);
      return { ok: false, reason: 'invalid' };
    }
  }

  const attempts = await store.incr(attemptKey(key), config.otp.ttlSeconds);
  if (attempts > config.otp.maxAttempts) {
    return { ok: false, reason: 'too_many_attempts' };
  }
  const saved = await store.get(otpKey(key));
  if (!saved) return { ok: false, reason: 'expired' };
  if (saved !== submitted) return { ok: false, reason: 'invalid' };

  // success — clean up
  await store.del(otpKey(key));
  await store.del(attemptKey(key));
  return { ok: true };
}

module.exports = { generateOtp, saveOtp, sendSms, verifyOtp, isOnCooldown, twilioEnabled };
