/**
 * Product — an item sold in the GlowOra Shop.
 */
const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, unique: true },
    brand: { type: String },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductCategory', required: true, index: true },
    description: { type: String, maxlength: 2000 },
    images: [{ type: String }],
    price: { type: Number, required: true, min: 0 },
    mrp: { type: Number, required: true, min: 0 },
    stock: { type: Number, default: 0, min: 0 },
    sku: { type: String, unique: true, sparse: true },
    unit: { type: String }, // e.g. "100ml"
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0 },
    tags: [{ type: String }],
    isFeatured: { type: Boolean, default: false },
    active: { type: Boolean, default: true },

    // 3 seller types (per documentation) with per-type commission
    sellerType: { type: String, enum: ['glowora', 'salon', 'brand'], default: 'glowora', index: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon' }, // set when sellerType === 'salon'
    sellerName: { type: String },     // brand/seller display name
    commissionPercent: { type: Number, default: 0 }, // 0 for own stock, 10 salon, 15 brand
  },
  { timestamps: true }
);

productSchema.index({ name: 'text', brand: 'text', tags: 'text' });

productSchema.pre('save', function (next) {
  if (!this.slug) {
    this.slug = `${this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${this._id.toString().slice(-5)}`;
  }
  next();
});

productSchema.virtual('discountPercent').get(function () {
  if (!this.mrp || this.mrp <= this.price) return 0;
  return Math.round(((this.mrp - this.price) / this.mrp) * 100);
});

module.exports = mongoose.model('Product', productSchema);
