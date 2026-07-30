/**
 * Salon — a partner business. Owned by a User with role 'owner'.
 * Goes through admin approval before appearing in search.
 */
const mongoose = require('mongoose');
const slugify = require('slugify');
const { encrypt, decrypt } = require('../utils/encryption');

// encrypt sensitive bank fields at rest, decrypt transparently on read
const enc = { set: (v) => (v ? encrypt(v) : v), get: (v) => (v ? decrypt(v) : v) };

const salonSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: [true, 'Salon name is required'], trim: true, maxlength: 120 },
    slug: { type: String, unique: true },
    description: { type: String, maxlength: 1000 },
    type: { type: String, enum: ['ladies', 'gents', 'unisex'], required: true },
    coverImage: { type: String },
    images: [{ type: String }],

    address: {
      line: { type: String, required: true },
      city: { type: String, required: true, index: true },
      state: { type: String },
      pincode: { type: String, match: [/^\d{6}$/, 'Enter a valid 6-digit pincode'] },
    },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },

    offersHomeService: { type: Boolean, default: false },
    homeServiceRadius: { type: Number, default: 5 }, // km
    openTime: { type: String, default: '09:00' },
    closeTime: { type: String, default: '20:00' },
    weeklyOff: [{ type: Number, min: 0, max: 6 }], // 0=Sun
    // per-day working hours override (optional)
    workingHours: {
      type: Map,
      of: new mongoose.Schema({ open: String, close: String, isOpen: Boolean }, { _id: false }),
    },
    breakStart: { type: String }, // 'HH:mm'
    breakEnd: { type: String },
    maxPerSlot: { type: Number, default: 1 },

    // payout / compliance (account number & PAN encrypted at rest)
    bankDetails: {
      accountName: String,
      accountNumber: { type: String, set: enc.set, get: enc.get },
      ifsc: String,
      upiId: String,
    },
    gstNumber: { type: String },
    panNumber: { type: String, set: enc.set, get: enc.get },

    // subscription
    subscriptionPlan: { type: String, enum: ['free', 'basic', 'pro'], default: 'free' },
    subscriptionExpiry: { type: Date },
    featuredExpiry: { type: Date },
    totalEarnings: { type: Number, default: 0 },
    pendingPayout: { type: Number, default: 0 },

    // aggregates (kept in sync on review/booking changes)
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0 },
    bookingCount: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ['pending', 'active', 'rejected', 'suspended'],
      default: 'pending',
      index: true,
    },
    isFeatured: { type: Boolean, default: false },
    rejectionReason: { type: String },
  },
  { timestamps: true }
);

salonSchema.index({ location: '2dsphere' });
salonSchema.index({ 'address.city': 1, status: 1 });

salonSchema.pre('save', function (next) {
  if (this.isModified('name') || !this.slug) {
    this.slug = `${slugify(this.name, { lower: true, strict: true })}-${this._id.toString().slice(-5)}`;
  }
  next();
});

module.exports = mongoose.model('Salon', salonSchema);
