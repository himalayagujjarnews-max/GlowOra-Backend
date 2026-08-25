/**
 * WalletTransaction — credit/debit ledger for a user's wallet & loyalty.
 */
const mongoose = require('mongoose');

const walletTxnSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['credit', 'debit'], required: true },
    amount: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true },
    source: {
      type: String,
      enum: ['topup', 'booking', 'refund', 'referral', 'cashback', 'admin_adjust', 'penalty'],
      required: true,
    },
    reference: { type: mongoose.Schema.Types.ObjectId }, // booking/payment id
    description: { type: String },
  },
  { timestamps: true }
);

walletTxnSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('WalletTransaction', walletTxnSchema);
