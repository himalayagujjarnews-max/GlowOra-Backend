/**
 * GiftVoucher — a prepaid voucher one user gifts to another (or a phone).
 */
const mongoose = require('mongoose');

const giftVoucherSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true },
    amount: { type: Number, required: true, min: 1 },
    balance: { type: Number, required: true, min: 0 },
    purchasedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    recipientName: { type: String },
    recipientPhone: { type: String },
    message: { type: String, maxlength: 300 },
    redeemedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['active', 'partially_used', 'used', 'expired'], default: 'active', index: true },
    validUntil: { type: Date, required: true },
    razorpayPaymentId: { type: String },
  },
  { timestamps: true }
);

giftVoucherSchema.pre('save', function (next) {
  if (!this.code) {
    this.code = 'GIFT' + Math.random().toString(36).slice(2, 8).toUpperCase();
  }
  next();
});

module.exports = mongoose.model('GiftVoucher', giftVoucherSchema);
