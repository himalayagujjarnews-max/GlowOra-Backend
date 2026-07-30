/**
 * ProductReview — customer rating of a GlowOra Shop product after purchase.
 */
const mongoose = require('mongoose');

const productReviewSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, maxlength: 120 },
    comment: { type: String, maxlength: 1000 },
    images: [{ type: String }],
    verifiedPurchase: { type: Boolean, default: false },
  },
  { timestamps: true }
);

productReviewSchema.index({ product: 1, customer: 1 }, { unique: true });

productReviewSchema.statics.syncProductRating = async function (productId) {
  const agg = await this.aggregate([
    { $match: { product: productId } },
    { $group: { _id: '$product', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const Product = mongoose.model('Product');
  if (agg.length) {
    await Product.findByIdAndUpdate(productId, { rating: Math.round(agg[0].avg * 10) / 10, reviewCount: agg[0].count });
  } else {
    await Product.findByIdAndUpdate(productId, { rating: 0, reviewCount: 0 });
  }
};

productReviewSchema.post('save', function () {
  this.constructor.syncProductRating(this.product);
});

module.exports = mongoose.model('ProductReview', productReviewSchema);
