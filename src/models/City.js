/**
 * City — service coverage areas. Controls where the app operates.
 */
const mongoose = require('mongoose');

const citySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    state: { type: String, required: true },
    center: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] },
    },
    launchStatus: { type: String, enum: ['live', 'coming_soon', 'planned'], default: 'planned' },
    salonCount: { type: Number, default: 0 },
    userCount: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

citySchema.index({ center: '2dsphere' });

module.exports = mongoose.model('City', citySchema);
