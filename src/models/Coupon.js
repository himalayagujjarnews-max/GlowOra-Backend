/**
 * Coupon — promotional discount codes.
 */
const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String },
    discountType: { type: String, enum: ['flat', 'percent'], required: true },
    discountValue: { type: Number, required: true, min: 0 },
    maxDiscount: { type: Number }, // cap for percent coupons
    minOrderValue: { type: Number, default: 0 },
    usageLimit: { type: Number, default: 0 }, // 0 = unlimited
    usedCount: { type: Number, default: 0 },
    perUserLimit: { type: Number, default: 1 },
    usedBy: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, count: Number }],
    applicableCity: { type: String }, // optional city scope
    validFrom: { type: Date, default: Date.now },
    validUntil: { type: Date, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

couponSchema.index({ code: 1, active: 1 });

module.exports = mongoose.model('Coupon', couponSchema);
