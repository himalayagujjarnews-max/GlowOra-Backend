/**
 * Address — saved customer addresses for home service bookings.
 */
const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    label: { type: String, enum: ['home', 'work', 'other'], default: 'home' },
    line1: { type: String, required: true },
    line2: { type: String },
    landmark: { type: String },
    city: { type: String, required: true },
    state: { type: String },
    pincode: { type: String, match: [/^\d{6}$/, 'Enter a valid 6-digit pincode'] },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] },
    },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

addressSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Address', addressSchema);
