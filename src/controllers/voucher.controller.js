/**
 * Gift Voucher controller — buy a voucher for someone, redeem to wallet.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const GiftVoucher = require('../models/GiftVoucher');
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const { debitWallet } = require('./wallet.controller');

// POST /vouchers/buy  { amount, recipientName, recipientPhone, message }
// Paid from the buyer's wallet (top up first). This guarantees the money
// was actually collected — no unverified payment IDs.
exports.buy = asyncHandler(async (req, res) => {
  const amount = parseInt(req.body.amount, 10);
  if (!amount || amount < 100) throw ApiError.badRequest('Minimum voucher value is ₹100');

  // charge the buyer's wallet up front (throws if insufficient)
  await debitWallet(req.user._id, amount, 'booking', 'Gift voucher purchase', undefined);

  const validUntil = new Date();
  validUntil.setFullYear(validUntil.getFullYear() + 1);
  const voucher = await GiftVoucher.create({
    amount, balance: amount,
    purchasedBy: req.user._id,
    recipientName: req.body.recipientName,
    recipientPhone: req.body.recipientPhone,
    message: req.body.message,
    validUntil,
  });
  sendResponse(res, 201, 'Voucher created and paid from your wallet', { voucher });
});

// GET /vouchers/mine  (purchased by me)
exports.mine = asyncHandler(async (req, res) => {
  const vouchers = await GiftVoucher.find({ purchasedBy: req.user._id }).sort({ createdAt: -1 });
  sendResponse(res, 200, 'Your vouchers', { vouchers });
});

// POST /vouchers/redeem  { code } — add voucher balance to wallet
exports.redeem = asyncHandler(async (req, res) => {
  const voucher = await GiftVoucher.findOne({ code: (req.body.code || '').toUpperCase() });
  if (!voucher) throw ApiError.notFound('Invalid voucher code');
  if (voucher.status === 'used' || voucher.balance <= 0) throw ApiError.badRequest('Voucher already used');
  if (voucher.validUntil < new Date()) throw ApiError.badRequest('Voucher has expired');

  const user = await User.findById(req.user._id);
  user.walletBalance += voucher.balance;
  await user.save();
  await WalletTransaction.create({
    user: user._id, type: 'credit', amount: voucher.balance, balanceAfter: user.walletBalance,
    source: 'cashback', description: `Gift voucher ${voucher.code} redeemed`,
  });

  const redeemed = voucher.balance;
  voucher.balance = 0;
  voucher.status = 'used';
  voucher.redeemedBy = user._id;
  await voucher.save();

  sendResponse(res, 200, `₹${redeemed} added to your wallet`, { credited: redeemed, walletBalance: user.walletBalance });
});
