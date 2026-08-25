/**
 * Staff — a stylist working at a salon. Optionally linked to a User account
 * (role 'staff') so they can log into the partner app.
 */
const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/encryption');

// encrypt sensitive bank fields at rest, decrypt transparently on read —
// same pattern as Salon.js.
const enc = { set: (v) => (v ? encrypt(v) : v), get: (v) => (v ? decrypt(v) : v) };

const staffSchema = new mongoose.Schema(
  {
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // login account, optional
    name: { type: String, required: true, trim: true },
    phone: { type: String, match: [/^[6-9]\d{9}$/, 'Enter a valid mobile number'] },
    avatar: { type: String },
    specialities: [{ type: String }], // e.g. ['hair', 'beard']
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0 },
    status: { type: String, enum: ['available', 'busy', 'leave', 'inactive'], default: 'available' },
    active: { type: Boolean, default: true },
    // Flat commission rate this stylist earns on the bookings they complete
    // (v1: single per-staff rate, no per-service overrides). Used to compute
    // Booking.commissionAmount when a booking is marked completed — see
    // booking.controller.js's updateStatus.
    commissionPercent: { type: Number, default: 0, min: 0, max: 100 },
    // Before/after work photos the stylist (or salon owner) adds to build a
    // portfolio shown on the customer app's salon detail screen. Plain
    // subdocuments (no separate collection) — same pattern as other small
    // embedded lists on this doc (e.g. `specialities`), just object-shaped.
    portfolio: [
      {
        before: { type: String, required: true },
        after: { type: String, required: true },
        caption: { type: String, trim: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],

    // Internal wallet — the owner sends this staff member's share of
    // earnings here (peer transfer from Salon.walletBalance), which then
    // auto-settles to the bank account below next day. See
    // partnerWallet.controller.js and scheduler.service.js `runWalletSettlement`.
    walletBalance: { type: Number, default: 0, min: 0 },
    // select: false — never returned unless a query explicitly opts in,
    // same reasoning as Salon.js's bankDetails.
    bankDetails: {
      accountName: { type: String, select: false },
      accountNumber: { type: String, set: enc.set, get: enc.get, select: false },
      ifsc: { type: String, select: false },
      upiId: { type: String, select: false },
    },
    // Set by admin after manually reviewing bankDetails — gates the T+1
    // auto-settlement job, same as Salon.bankVerified.
    bankVerified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Staff', staffSchema);
