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
} else {
  logger.warn('⚠️  Razorpay not configured — payments will be mocked in dev.');
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
  return expected === signature;
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
  return expected === signature;
}

async function refund(paymentId, amount) {
  if (!enabled) return { id: `rfnd_mock_${Date.now()}`, amount: amount * 100, status: 'processed', mock: true };
  return instance.payments.refund(paymentId, { amount: Math.round(amount * 100) });
}

module.exports = { instance, enabled, createOrder, verifyPaymentSignature, verifyWebhookSignature, refund, keyId: config.razorpay.keyId };
