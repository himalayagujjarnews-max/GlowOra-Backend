/**
 * Payout — money transferred from a wallet (salon or staff) to the
 * recipient's bank account. Originally salon-only (admin manually reviewed
 * every completed booking); now generalized to also cover staff, and to be
 * created automatically by the T+1 wallet settlement job
 * (scheduler.service.js `runWalletSettlement`) as well as by admin manually.
 */
const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema(
  {
    recipientType: { type: String, enum: ['salon', 'staff'], default: 'salon', index: true },
    // Kept as `salon` (not renamed) for backward compatibility with existing
    // salon-payout code (payout.controller.js's `mine`/`create`/`pending`) —
    // only set when recipientType === 'salon'.
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', index: true },
    // Only set when recipientType === 'staff'.
    staff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', index: true },
    amount: { type: Number, required: true },
    bookingsCount: { type: Number, default: 0 },
    periodFrom: { type: String }, // 'YYYY-MM-DD'
    periodTo: { type: String },
    status: { type: String, enum: ['pending', 'processing', 'paid', 'failed'], default: 'pending', index: true },
    method: { type: String, enum: ['bank', 'upi'], default: 'bank' },
    reference: { type: String }, // transaction ref
    // 'wallet_settlement' = created automatically by the daily auto-transfer
    // job; 'manual' = admin recorded an offline transfer (the original flow).
    source: { type: String, enum: ['manual', 'wallet_settlement'], default: 'manual' },
    processedAt: { type: Date },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String },
  },
  { timestamps: true }
);

payoutSchema.pre('validate', function (next) {
  if (this.recipientType === 'salon' && !this.salon) return next(new Error('salon is required when recipientType is salon'));
  if (this.recipientType === 'staff' && !this.staff) return next(new Error('staff is required when recipientType is staff'));
  next();
});

module.exports = mongoose.model('Payout', payoutSchema);
