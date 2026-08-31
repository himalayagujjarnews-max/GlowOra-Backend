/**
 * Payment controller — Razorpay order creation, verification, webhook, refund.
 * Works with mock mode in dev when Razorpay keys are absent.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const config = require('../config/env');
const rp = require('../config/razorpay');
const Payment = require('../models/Payment');
const Booking = require('../models/Booking');
const WalletTransaction = require('../models/WalletTransaction');
const { notifyUser } = require('../services/notification.service');
const logger = require('../utils/logger');

// POST /payments/create-order   { bookingId }
exports.createOrder = asyncHandler(async (req, res) => {
  const { bookingId } = req.body;
  const booking = await Booking.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.customer.toString() !== req.user._id.toString()) throw ApiError.forbidden('Not your booking');
  if (booking.paymentStatus === 'paid') throw ApiError.badRequest('This booking is already paid');
  if (!['token', 'full_online'].includes(booking.paymentMode)) {
    throw ApiError.badRequest('This booking is not set for online payment');
  }

  // token bookings pay the ₹49 token now; full_online pays the whole amount
  const amount = booking.paymentMode === 'token'
    ? Math.min(config.tokenAmount, booking.total)
    : booking.total;

  const order = await rp.createOrder({
    amount,
    receipt: booking.bookingCode,
    notes: { bookingId: booking._id.toString(), customer: req.user._id.toString() },
  });

  const payment = await Payment.create({
    booking: booking._id,
    customer: req.user._id,
    amount,
    type: booking.paymentMode === 'full_online' ? 'full_online' : 'token',
    razorpayOrderId: order.id,
    status: 'created',
  });

  sendResponse(res, 201, 'Order created', {
    orderId: order.id,
    amount,
    currency: 'INR',
    keyId: rp.keyId || 'mock',
    paymentId: payment._id,
    mock: order.mock || false,
  });
});

// POST /payments/verify   { razorpayOrderId, razorpayPaymentId, razorpaySignature }
exports.verify = asyncHandler(async (req, res) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
  if (!razorpayOrderId || !razorpayPaymentId) throw ApiError.badRequest('Missing payment fields');

  const valid = rp.verifyPaymentSignature({
    orderId: razorpayOrderId,
    paymentId: razorpayPaymentId,
    signature: razorpaySignature,
  });
  if (!valid) throw ApiError.badRequest('Payment signature verification failed');

  const payment = await Payment.findOne({ razorpayOrderId });
  if (!payment) throw ApiError.notFound('Payment record not found');
  if (payment.status === 'paid') return sendResponse(res, 200, 'Payment already verified', { payment });

  payment.razorpayPaymentId = razorpayPaymentId;
  payment.razorpaySignature = razorpaySignature;
  payment.status = 'paid';
  await payment.save();

  await reconcileBookingPayment(payment);

  sendResponse(res, 200, 'Payment verified', { payment });
});

/**
 * Apply a captured Payment to its booking. Idempotent: only applies once,
 * guarded by booking.paymentStatus. Shared by verify() and webhook().
 */
async function reconcileBookingPayment(payment) {
  if (!payment.booking) return; // wallet top-ups have no booking
  const booking = await Booking.findById(payment.booking);
  if (!booking) return;
  if (booking.paymentStatus === 'paid') return; // already reconciled

  booking.amountPaid += payment.amount;
  booking.amountDue = Math.max(0, booking.total - booking.amountPaid);
  booking.paymentStatus = booking.amountPaid >= booking.total ? 'paid' : 'token_paid';
  if (booking.status === 'pending') booking.status = 'confirmed';
  booking.communicationUnlocked = true;
  await booking.save();
  notifyUser(booking.customer, {
    title: 'Payment received ✓',
    body: `₹${payment.amount} paid for booking ${booking.bookingCode}.`,
    type: 'payment',
    data: { bookingId: booking._id.toString() },
  });
}

// POST /payments/webhook   (Razorpay server-to-server; raw body)
exports.webhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const raw = req.rawBody || JSON.stringify(req.body);
  if (!rp.verifyWebhookSignature(raw, signature)) {
    logger.warn('Invalid Razorpay webhook signature');
    return res.status(400).json({ success: false });
  }
  const event = req.body.event;
  logger.info(`Razorpay webhook: ${event}`);
  // Handle events idempotently (payment.captured, refund.processed, etc.)
  if (event === 'payment.captured') {
    const entity = req.body.payload.payment.entity;
    const payment = await Payment.findOne({ razorpayOrderId: entity.order_id });
    if (payment && payment.status !== 'paid') {
      payment.status = 'paid';
      payment.method = entity.method;
      payment.razorpayPaymentId = entity.id;
      await payment.save();
      // reconcile booking (if any) — safe even if client also calls /verify
      await reconcileBookingPayment(payment);
      // reconcile wallet top-up
      if (payment.type === 'wallet_topup') {
        const { creditWallet } = require('./wallet.controller');
        const already = await WalletTransaction.findOne({ reference: payment._id, source: 'topup' });
        if (!already) await creditWallet(payment.customer, payment.amount, 'topup', 'Wallet top-up', payment._id);
      }
    }
  }
  res.json({ success: true });
});

// GET /payments/mine
exports.myPayments = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const filter = { customer: req.user._id };
  const [payments, total] = await Promise.all([
    Payment.find(filter)
      .populate('booking', 'bookingCode date')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Payment.countDocuments(filter),
  ]);
  sendResponse(res, 200, 'Payments', { payments, page, limit, total, hasMore: page * limit < total });
});
