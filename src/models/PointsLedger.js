/**
 * PointsLedger — earn/redeem ledger for a user's Glow Points, mirroring
 * WalletTransaction's pattern so the mobile app can show a real "Recent
 * activity" feed instead of the balance-only counter on User.glowPoints.
 */
const mongoose = require('mongoose');

const pointsLedgerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['earned', 'redeemed'], required: true },
    // Always stored positive; `type` conveys direction (kept simple — every
    // existing glowPoints write already deals in positive amounts and uses
    // $inc with a sign chosen at the call site).
    points: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true }, // e.g. "Booking at Glow Studio", "Redeemed for discount"
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' }, // optional link to the triggering booking
    balanceAfter: { type: Number }, // snapshot of user's glowPoints total after this entry
  },
  { timestamps: true }
);

pointsLedgerSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('PointsLedger', pointsLedgerSchema);
