/**
 * ServicePackage — a bundle of services offered at a combined price.
 */
const mongoose = require('mongoose');

const packageSchema = new mongoose.Schema(
  {
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, maxlength: 500 },
    services: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],
    originalPrice: { type: Number, required: true },
    packagePrice: { type: Number, required: true },
    durationMinutes: { type: Number, required: true },
    image: { type: String },
    forGender: { type: String, enum: ['male', 'female', 'unisex'], default: 'unisex' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ServicePackage', packageSchema);
