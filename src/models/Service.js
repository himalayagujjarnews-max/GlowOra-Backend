/**
 * Service — an offering by a salon (Haircut, Facial, etc.).
 * Salons set their own prices and durations.
 */
const mongoose = require('mongoose');

const CATEGORIES = ['hair', 'beard', 'face', 'hands', 'feet', 'body', 'makeup', 'bridal', 'spa', 'nails'];

const serviceSchema = new mongoose.Schema(
  {
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    category: { type: String, enum: CATEGORIES, required: true, index: true },
    forGender: { type: String, enum: ['male', 'female', 'unisex'], default: 'unisex' },
    price: { type: Number, required: true, min: 0 },
    discountPrice: { type: Number, min: 0 },
    durationMinutes: { type: Number, required: true, min: 5 },
    description: { type: String, maxlength: 500 },
    image: { type: String },
    homeServiceAvailable: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

serviceSchema.index({ salon: 1, category: 1 });

serviceSchema.statics.CATEGORIES = CATEGORIES;

module.exports = mongoose.model('Service', serviceSchema);
