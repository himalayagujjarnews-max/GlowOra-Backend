/**
 * ProductCategory — GlowOra Shop product categories (Skincare, Haircare, etc.).
 */
const mongoose = require('mongoose');

const productCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, unique: true },
    image: { type: String },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

productCategorySchema.pre('save', function (next) {
  if (!this.slug) this.slug = this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  next();
});

module.exports = mongoose.model('ProductCategory', productCategorySchema);
