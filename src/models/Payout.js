/**
 * Payout — money transferred from platform to a salon for completed bookings.
 */
const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema(
  {
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    amount: { type: Number, required: true },
    bookingsCount: { type: Number, default: 0 },
    periodFrom: { type: String }, // 'YYYY-MM-DD'
    periodTo: { type: String },
    status: { type: String, enum: ['pending', 'processing', 'paid', 'failed'], default: 'pending', index: true },
    method: { type: String, enum: ['bank', 'upi'], default: 'bank' },
    reference: { type: String }, // transaction ref
    processedAt: { type: Date },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Payout', payoutSchema);
