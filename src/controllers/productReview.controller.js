/**
 * ProductReview controller — customers review purchased products.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const { getPagination, buildMeta } = require('../utils/pagination');
const ProductReview = require('../models/ProductReview');
const Order = require('../models/Order');

// GET /product-reviews?product=
exports.list = asyncHandler(async (req, res) => {
  if (!req.query.product) throw ApiError.badRequest('product query param required');
  const { page, limit, skip } = getPagination(req.query);
  const [reviews, total] = await Promise.all([
    ProductReview.find({ product: req.query.product }).populate('customer', 'name avatar').sort({ createdAt: -1 }).skip(skip).limit(limit),
    ProductReview.countDocuments({ product: req.query.product }),
  ]);
  sendResponse(res, 200, 'Product reviews', { reviews }, buildMeta(page, limit, total));
});

// POST /product-reviews   { product, rating, title, comment, images }
exports.create = asyncHandler(async (req, res) => {
  const { product, rating } = req.body;
  if (!product || !rating) throw ApiError.badRequest('product and rating are required');

  // verified purchase check
  const purchased = await Order.findOne({
    customer: req.user._id,
    'items.product': product,
    paymentStatus: { $in: ['paid'] },
  });

  try {
    const review = await ProductReview.create({
      product,
      customer: req.user._id,
      rating,
      title: req.body.title,
      comment: req.body.comment,
      images: req.body.images || [],
      verifiedPurchase: Boolean(purchased),
    });
    sendResponse(res, 201, 'Review added', { review });
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('You have already reviewed this product');
    throw err;
  }
});

// DELETE /product-reviews/:id  (own or admin)
exports.remove = asyncHandler(async (req, res) => {
  const review = await ProductReview.findById(req.params.id);
  if (!review) throw ApiError.notFound('Review not found');
  if (review.customer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw ApiError.forbidden('Not your review');
  }
  await review.deleteOne();
  await ProductReview.syncProductRating(review.product);
  sendResponse(res, 200, 'Review removed');
});
