/**
 * Razorpay client. In dev without keys, returns mock orders so the
 * booking/payment flow can be tested end-to-end.
 */
const crypto = require('crypto');
const config = require('./env');
const logger = require('../utils/logger');

let instance = null;
const enabled = Boolean(config.razorpay.keyId && config.razorpay.secret);

if (enabled) {
  const Razorpay = require('razorpay');
  instance = new Razorpay({ key_id: config.razorpay.keyId, key_secret: config.razorpay.secret });
} else if (config.isProd) {
  // Previously this only logged a warning and let every payment/wallet-topup
  // signature check silently return `true` ("mock always valid") — in
  // production, a missing Razorpay key due to a deploy/env misconfiguration
  // would mean ANYONE could mark any payment "verified" for free. Fail loud
  // and hard on boot instead of fail-open on every request.
  throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set in production — refusing to start with payment verification disabled.');
} else {
  logger.warn('⚠️  Razorpay not configured — payments will be mocked in dev.');
}

/** Constant-time string compare — avoids timing side-channels on signature checks. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function createOrder({ amount, currency = 'INR', receipt, notes }) {
  if (!enabled) {
    return {
      id: `order_mock_${Date.now()}`,
      amount: amount * 100,
      currency,
      receipt,
      status: 'created',
      mock: true,
    };
  }
  return instance.orders.create({ amount: Math.round(amount * 100), currency, receipt, notes });
}

/**
 * Verify the signature returned by Razorpay checkout.
 */
function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!enabled) return true; // mock always valid in dev
  const expected = crypto
    .createHmac('sha256', config.razorpay.secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return safeEqual(expected, signature);
}

/**
 * Verify a webhook payload signature.
 */
function verifyWebhookSignature(rawBody, signature) {
  if (!config.razorpay.webhookSecret) return false;
  const expected = crypto
    .createHmac('sha256', config.razorpay.webhookSecret)
    .update(rawBody)
    .digest('hex');
  return safeEqual(expected, signature);
}

async function refund(paymentId, amount) {
  if (!enabled) return { id: `rfnd_mock_${Date.now()}`, amount: amount * 100, status: 'processed', mock: true };
  return instance.payments.refund(paymentId, { amount: Math.round(amount * 100) });
}

module.exports = { instance, enabled, createOrder, verifyPaymentSignature, verifyWebhookSignature, refund, keyId: config.razorpay.keyId };
