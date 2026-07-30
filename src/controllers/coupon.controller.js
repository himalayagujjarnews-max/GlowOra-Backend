/**
 * Coupon controller — admin CRUD + customer validate/apply.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const Coupon = require('../models/Coupon');
const { money } = require('../utils/helpers');

/** Core logic: compute discount for a coupon against an order value. */
async function evaluate(code, orderValue, user, city) {
  const coupon = await Coupon.findOne({ code: (code || '').toUpperCase(), active: true });
  if (!coupon) throw ApiError.notFound('Invalid coupon code');
  const now = new Date();
  if (coupon.validFrom > now) throw ApiError.badRequest('Coupon not yet active');
  if (coupon.validUntil < now) throw ApiError.badRequest('Coupon has expired');
  if (coupon.applicableCity && city && coupon.applicableCity.toLowerCase() !== city.toLowerCase()) {
    throw ApiError.badRequest('Coupon not valid in your city');
  }
  if (orderValue < coupon.minOrderValue) {
    throw ApiError.badRequest(`Minimum order value is ₹${coupon.minOrderValue}`);
  }
  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
    throw ApiError.badRequest('Coupon usage limit reached');
  }
  const used = coupon.usedBy.find((u) => u.user.toString() === user._id.toString());
  if (used && used.count >= coupon.perUserLimit) {
    throw ApiError.badRequest('You have already used this coupon');
  }
  let discount = coupon.discountType === 'flat'
    ? coupon.discountValue
    : (orderValue * coupon.discountValue) / 100;
  if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
  discount = Math.min(discount, orderValue);
  return { coupon, discount: money(discount) };
}
exports.evaluate = evaluate;

// GET /coupons  (public — active coupons for display)
exports.listActive = asyncHandler(async (req, res) => {
  const filter = { active: true, validUntil: { $gte: new Date() } };
  if (req.query.city) filter.$or = [{ applicableCity: null }, { applicableCity: req.query.city }];
  const coupons = await Coupon.find(filter).select('code description discountType discountValue maxDiscount minOrderValue validUntil');
  sendResponse(res, 200, 'Coupons', { coupons });
});

// POST /coupons/validate   { code, orderValue, city }
exports.validate = asyncHandler(async (req, res) => {
  const { code, orderValue, city } = req.body;
  const { coupon, discount } = await evaluate(code, Number(orderValue) || 0, req.user, city);
  sendResponse(res, 200, 'Coupon applied', { code: coupon.code, discount, finalValue: money((Number(orderValue) || 0) - discount) });
});

// ---- Admin ----
// POST /coupons  (admin)
exports.create = asyncHandler(async (req, res) => {
  const coupon = await Coupon.create(req.body);
  sendResponse(res, 201, 'Coupon created', { coupon });
});

// GET /coupons/admin/all  (admin)
exports.adminList = asyncHandler(async (req, res) => {
  const coupons = await Coupon.find().sort({ createdAt: -1 });
  sendResponse(res, 200, 'All coupons', { coupons });
});

// PATCH /coupons/:id  (admin)
exports.update = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!coupon) throw ApiError.notFound('Coupon not found');
  sendResponse(res, 200, 'Coupon updated', { coupon });
});

// DELETE /coupons/:id  (admin)
exports.remove = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  if (!coupon) throw ApiError.notFound('Coupon not found');
  sendResponse(res, 200, 'Coupon deactivated');
});
