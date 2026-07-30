/**
 * Offer — salon-created discounts & happy hours (distinct from global Coupons).
 */
const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema(
  {
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    title: { type: String, required: true },
    description: { type: String },
    discountType: { type: String, enum: ['flat', 'percent'], required: true },
    discountValue: { type: Number, required: true, min: 0 },
    type: { type: String, enum: ['general', 'happy_hour', 'festival'], default: 'general' },
    // happy hour window (optional)
    daysOfWeek: [{ type: Number, min: 0, max: 6 }],
    startTime: { type: String }, // 'HH:mm'
    endTime: { type: String },
    applicableServices: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],
    validFrom: { type: Date, default: Date.now },
    validUntil: { type: Date, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

offerSchema.index({ salon: 1, active: 1 });

module.exports = mongoose.model('Offer', offerSchema);
