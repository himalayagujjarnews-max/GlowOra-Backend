/**
 * User — customers, salon owners, staff, and admins all live here,
 * differentiated by `role`. Customers use OTP; owners/admins may use a password.
 */
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 80 },
    // phone OR email is required (enforced in the auth controller). Optional +
    // sparse here so email-first signups (no phone yet) are valid, and the
    // unique index ignores documents without a phone.
    phone: {
      type: String,
      unique: true,
      sparse: true,
      match: [/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
      match: [/^\S+@\S+\.\S+$/, 'Enter a valid email'],
    },
    password: { type: String, select: false }, // hashed; for owner/admin login
    gender: { type: String, enum: ['male', 'female', 'other'] },
    dob: { type: Date },
    // `role` = the ACTIVE role for the current app/session context (drives every
    // permission check throughout the backend — unchanged behaviour).
    role: {
      type: String,
      enum: ['customer', 'owner', 'staff', 'admin'],
      default: 'customer',
      index: true,
    },
    // `roles` = every role this identity has ever unlocked. One phone/email/
    // Google account can be a customer AND a salon owner AND staff at the same
    // time — logging into a different app just switches which role is
    // "active" (see resolveLoginRole in auth.controller.js), it never creates
    // a second account. 'staff' and 'admin' can only ever be added here by an
    // owner/admin explicitly — never granted via self-service login.
    roles: {
      type: [{ type: String, enum: ['customer', 'owner', 'staff', 'admin'] }],
      default: ['customer'],
    },
    avatar: { type: String },
    avatarPublicId: { type: String },
    city: { type: String, trim: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
    },
    walletBalance: { type: Number, default: 0, min: 0 },
    glowPoints: { type: Number, default: 0, min: 0 },
    // Lifetime spend across completed bookings — drives the loyalty tier
    // (see User.getTier below). Incremented only in booking.controller.js's
    // updateStatus() 'completed' branch, alongside Glow Points crediting.
    totalSpent: { type: Number, default: 0, min: 0 },
    referralCode: { type: String, unique: true, sparse: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    fcmTokens: [{ type: String }],
    phoneVerified: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    blockedReason: { type: String },

    // security
    loginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    passwordChangedAt: { type: Date, select: false },

    // two-factor auth (TOTP)
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, select: false },       // encrypted
    twoFactorBackupCodes: { type: [String], select: false }, // hashed
    twoFactorVerifiedAt: { type: Date },

    // GDPR / data protection
    consentVersion: { type: String },
    marketingConsent: { type: Boolean, default: false },
    dataExportRequestedAt: { type: Date },
    anonymizedAt: { type: Date },

    // salons rate customers (reliability/behaviour) after completed bookings —
    // separate from the salon's own rating; helps salons vet home-service requests
    customerRating: { type: Number, default: 0, min: 0, max: 5 },
    customerRatingCount: { type: Number, default: 0 },

    // Selfie-based identity check for salon owners & staff (not customers —
    // out of scope per the owner's request). No automated face-matching API
    // is wired up (would need e.g. AWS Rekognition/Azure Face) — this is
    // upload + admin manual review, same convention as Salon/Staff.bankVerified.
    identityVerification: {
      selfieUrl: { type: String },
      selfiePublicId: { type: String },
      status: { type: String, enum: ['not_submitted', 'pending', 'verified', 'rejected'], default: 'not_submitted' },
      rejectionReason: { type: String },
      submittedAt: { type: Date },
      reviewedAt: { type: Date },
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },

    lastLoginAt: { type: Date },
    notificationsEnabled: { type: Boolean, default: true },
    // Per-category push/in-app preferences. Keys map to the Notification
    // `type` enum: 'booking'/'payment'/'review' → bookings, 'promo' → offers,
    // 'chat' → chat, 'system' → system (see TYPE_TO_PREF in
    // notification.service.js). All default true; toggled from
    // Settings > Notification preferences.
    notificationPrefs: {
      bookings: { type: Boolean, default: true },
      offers: { type: Boolean, default: true },
      chat: { type: Boolean, default: true },
      system: { type: Boolean, default: true },
    },
    language: { type: String, enum: ['hi', 'en', 'pa'], default: 'en' },
  },
  { timestamps: true }
);

userSchema.index({ location: '2dsphere' });

userSchema.virtual('isLocked').get(function () {
  return this.lockUntil && this.lockUntil > Date.now();
});

// Loyalty tier thresholds, based on lifetime spend (`totalSpent`). Bronze is
// the default with no minimum; silver/gold unlock at the thresholds below.
// Kept as a static so both the model and controllers (e.g. auth.controller's
// publicUser, booking.controller's points crediting) can share one source
// of truth for tier boundaries and perks.
userSchema.statics.getTier = function (totalSpent = 0) {
  if (totalSpent > 20000) return 'gold';
  if (totalSpent >= 5000) return 'silver';
  return 'bronze';
};

// Extra Glow Points multiplier per tier — applied on top of the base
// points-per-rupee rate when a booking completes (see booking.controller.js).
userSchema.statics.TIER_POINTS_MULTIPLIER = { bronze: 1, silver: 1.05, gold: 1.1 };

userSchema.pre('save', function (next) {
  if (!this.referralCode) {
    this.referralCode = `GLOW${this._id.toString().slice(-6).toUpperCase()}`;
  }
  // Keep `roles` in sync with `role` — covers legacy documents saved before
  // `roles` existed, and any code path that sets `role` directly.
  if (!this.roles) this.roles = [];
  if (this.role && !this.roles.includes(this.role)) this.roles.push(this.role);
  next();
});

module.exports = mongoose.model('User', userSchema);
