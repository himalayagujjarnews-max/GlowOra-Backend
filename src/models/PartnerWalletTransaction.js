/**
 * PartnerWalletTransaction — credit/debit ledger for salon & staff internal
 * wallets. Mirrors WalletTransaction.js (the customer-side ledger) but
 * supports two different kinds of wallet owner (a Salon or a Staff member)
 * via `ownerType` + a plain ObjectId `owner` (refPath keeps population working
 * for either type without a separate collection per owner type).
 *
 * Every rupee that moves through a partner wallet — a booking's earnings
 * landing here, an owner sending money to a staff member, or the daily
 * settlement to a bank account — gets one of these rows, so both sides of
 * the ledger are always fully auditable.
 */
const mongoose = require('mongoose');

const partnerWalletTxnSchema = new mongoose.Schema(
  {
    ownerType: { type: String, enum: ['salon', 'staff'], required: true, index: true },
    // Mongoose's refPath needs a real stored field holding the EXACT model
    // name ('Salon'/'Staff') — kept in sync with `ownerType` via the pre-save
    // hook below, so callers only ever need to set `ownerType`.
    ownerModel: { type: String, enum: ['Salon', 'Staff'] },
    owner: { type: mongoose.Schema.Types.ObjectId, required: true, index: true, refPath: 'ownerModel' },
    type: { type: String, enum: ['credit', 'debit'], required: true },
    amount: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true },
    source: {
      type: String,
      enum: [
        'booking_earning', // online-paid booking completed -> credited to salon wallet
        'transfer_in',     // owner -> staff peer transfer, staff side
        'transfer_out',    // owner -> staff peer transfer, salon side
        'payout',          // T+1 auto-settlement debit to bank account
        'admin_adjust',    // manual correction by admin
        'referral_bonus',  // a salon this owner referred completed its first booking
      ],
      required: true,
    },
    reference: { type: mongoose.Schema.Types.ObjectId }, // booking/payout/transfer id
    description: { type: String },
    // who initiated this movement (owner sending to staff, or admin adjusting) —
    // null for system-driven entries like booking_earning/payout.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

partnerWalletTxnSchema.pre('save', function (next) {
  this.ownerModel = this.ownerType === 'staff' ? 'Staff' : 'Salon';
  next();
});

partnerWalletTxnSchema.index({ ownerType: 1, owner: 1, createdAt: -1 });

module.exports = mongoose.model('PartnerWalletTransaction', partnerWalletTxnSchema);
