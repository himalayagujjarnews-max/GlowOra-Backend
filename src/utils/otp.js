/**
 * OTP generation, storage (Redis), and SMS sending (MSG91).
 * In dev without MSG91 configured, the OTP is logged instead of sent.
 */
const crypto = require('crypto');
const axios = require('axios');
const config = require('../config/env');
const { store } = require('../config/redis');
const logger = require('./logger');

const otpKey = (phone) => `otp:${phone}`;
const attemptKey = (phone) => `otp_attempts:${phone}`;
const cooldownKey = (phone) => `otp_cooldown:${phone}`;

function generateOtp() {
  // cryptographically-random N-digit code
  const max = 10 ** config.otp.length;
  const num = crypto.randomInt(0, max);
  return num.toString().padStart(config.otp.length, '0');
}

async function isOnCooldown(phone) {
  return (await store.get(cooldownKey(phone))) !== null;
}

async function saveOtp(phone, otp) {
  await store.set(otpKey(phone), otp, config.otp.ttlSeconds);
  await store.set(cooldownKey(phone), '1', config.otp.resendCooldownSeconds);
  await store.del(attemptKey(phone));
}

async function sendSms(phone, otp) {
  if (!config.msg91.apiKey) {
    // Use console.log directly so it ALWAYS shows, regardless of log level/format.
    console.log('\n============================================');
    console.log(`  📩  DEV OTP for ${phone}  =  ${otp}`);
    console.log('============================================\n');
    logger.info(`📩 [DEV] OTP for ${phone} is ${otp} (MSG91 not configured)`);
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

async function verifyOtp(phone, submitted) {
  const attempts = await store.incr(attemptKey(phone), config.otp.ttlSeconds);
  if (attempts > config.otp.maxAttempts) {
    return { ok: false, reason: 'too_many_attempts' };
  }
  const saved = await store.get(otpKey(phone));
  if (!saved) return { ok: false, reason: 'expired' };
  if (saved !== submitted) return { ok: false, reason: 'invalid' };

  // success — clean up
  await store.del(otpKey(phone));
  await store.del(attemptKey(phone));
  return { ok: true };
}

module.exports = { generateOtp, saveOtp, sendSms, verifyOtp, isOnCooldown };
