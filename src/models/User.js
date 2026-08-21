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

    lastLoginAt: { type: Date },
    notificationsEnabled: { type: Boolean, default: true },
    language: { type: String, enum: ['hi', 'en', 'pa'], default: 'en' },
  },
  { timestamps: true }
);

userSchema.index({ location: '2dsphere' });

userSchema.virtual('isLocked').get(function () {
  return this.lockUntil && this.lockUntil > Date.now();
});

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
