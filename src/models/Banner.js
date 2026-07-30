/**
 * Banner — promotional home-screen banners.
 */
const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema(
  {
    title: { type: String },
    image: { type: String, required: true },
    imagePublicId: { type: String },
    link: { type: String }, // deep link / route
    type: { type: String, enum: ['home', 'offer', 'category'], default: 'home' },
    city: { type: String }, // optional targeting
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    validUntil: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Banner', bannerSchema);
