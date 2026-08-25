/**
 * Wallet controller — top-up (via Razorpay), balance & transaction history.
 * Debits happen inside booking payment logic; this covers top-ups & views.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const { getPagination, buildMeta } = require('../utils/pagination');
const rp = require('../config/razorpay');
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const Payment = require('../models/Payment');

// GET /wallet
exports.get = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('walletBalance glowPoints');
  sendResponse(res, 200, 'Wallet', { balance: user.walletBalance, glowPoints: user.glowPoints });
});

// GET /wallet/transactions
exports.transactions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const [txns, total] = await Promise.all([
    WalletTransaction.find({ user: req.user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    WalletTransaction.countDocuments({ user: req.user._id }),
  ]);
  sendResponse(res, 200, 'Transactions', { transactions: txns }, buildMeta(page, limit, total));
});

// POST /wallet/topup/create-order   { amount }
// The amount is recorded server-side in a Payment record so it can't be
// tampered with at verify time.
exports.createTopupOrder = asyncHandler(async (req, res) => {
  const amount = parseInt(req.body.amount, 10);
  if (!amount || amount < 1 || amount > 100000) throw ApiError.badRequest('Enter a valid amount (₹1–₹1,00,000)');
  const order = await rp.createOrder({
    amount, receipt: `wallet_${req.user._id}_${Date.now()}`,
    notes: { type: 'wallet_topup', user: req.user._id.toString() },
  });
  await Payment.create({
    customer: req.user._id, amount, type: 'wallet_topup',
    razorpayOrderId: order.id, status: 'created',
  });
  sendResponse(res, 201, 'Top-up order created', { orderId: order.id, amount, keyId: rp.keyId || 'mock', mock: order.mock || false });
});

// POST /wallet/topup/verify   { razorpayOrderId, razorpayPaymentId, razorpaySignature }
// Amount is taken from the server-side Payment record, NOT from the client.
exports.verifyTopup = asyncHandler(async (req, res) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
  if (!razorpayOrderId || !razorpayPaymentId) throw ApiError.badRequest('Missing payment fields');

  const payment = await Payment.findOne({ razorpayOrderId, customer: req.user._id, type: 'wallet_topup' });
  if (!payment) throw ApiError.notFound('Top-up order not found');
  if (payment.status === 'paid') throw ApiError.badRequest('This top-up is already processed');

  const valid = rp.verifyPaymentSignature({ orderId: razorpayOrderId, paymentId: razorpayPaymentId, signature: razorpaySignature });
  if (!valid) { payment.status = 'failed'; await payment.save(); throw ApiError.badRequest('Payment verification failed'); }

  payment.status = 'paid';
  payment.razorpayPaymentId = razorpayPaymentId;
  payment.razorpaySignature = razorpaySignature;
  await payment.save();

  // Atomic $inc, not a read-then-write — two concurrent verify calls (e.g. a
  // retried webhook + the client's own poll) can't both add the amount.
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $inc: { walletBalance: payment.amount } },
    { new: true }
  );
  await WalletTransaction.create({
    user: user._id, type: 'credit', amount: payment.amount, balanceAfter: user.walletBalance,
    source: 'topup', reference: payment._id, description: 'Wallet top-up',
  });
  sendResponse(res, 200, 'Wallet topped up', { balance: user.walletBalance });
});

module.exports.creditWallet = async function creditWallet(userId, amount, source, description, reference) {
  // Atomic — see debitWallet's comment for why this matters.
  const user = await User.findByIdAndUpdate(userId, { $inc: { walletBalance: amount } }, { new: true });
  if (!user) return null;
  await WalletTransaction.create({ user: userId, type: 'credit', amount, balanceAfter: user.walletBalance, source, description, reference });
  return user.walletBalance;
};

// Debit wallet — throws if insufficient balance. Returns new balance.
//
// This used to be read-balance -> check -> write-balance, three separate
// steps with no lock between them. Two concurrent debits (e.g. a booking
// paid from wallet plus a near-simultaneous retry, or two tabs) could both
// read the same starting balance, both pass the `>= amount` check, and both
// write — draining the wallet below zero. Fixed with a single atomic
// `findOneAndUpdate` whose FILTER itself enforces the balance guard
// (`walletBalance: { $gte: amount }`), so only one of two racing requests
// can ever match and decrement; the other gets a null result deterministically.
module.exports.debitWallet = async function debitWallet(userId, amount, source, description, reference) {
  const user = await User.findOneAndUpdate(
    { _id: userId, walletBalance: { $gte: amount } },
    { $inc: { walletBalance: -amount } },
    { new: true }
  );
  if (!user) {
    // Either the user doesn't exist, or the balance guard failed — check
    // which, purely to give an accurate error message (the update itself
    // already safely did nothing in either case).
    const exists = await User.exists({ _id: userId });
    if (!exists) throw ApiError.notFound('User not found');
    throw ApiError.badRequest('Insufficient wallet balance');
  }
  await WalletTransaction.create({ user: userId, type: 'debit', amount, balanceAfter: user.walletBalance, source, description, reference });
  return user.walletBalance;
};
