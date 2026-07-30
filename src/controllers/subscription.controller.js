/**
 * Subscription controller — plan catalog (admin), salon subscribe,
 * customer Glow Pass buy & usage tracking.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Subscription = require('../models/Subscription');
const Salon = require('../models/Salon');

// GET /subscriptions/plans?audience=salon|customer  (public)
exports.listPlans = asyncHandler(async (req, res) => {
  const filter = { active: true };
  if (req.query.audience) filter.audience = req.query.audience;
  const plans = await SubscriptionPlan.find(filter).sort({ order: 1, price: 1 });
  sendResponse(res, 200, 'Plans', { plans });
});

// POST /subscriptions/plans  (admin)
exports.createPlan = asyncHandler(async (req, res) => {
  const plan = await SubscriptionPlan.create(req.body);
  sendResponse(res, 201, 'Plan created', { plan });
});

// PATCH /subscriptions/plans/:id  (admin)
exports.updatePlan = asyncHandler(async (req, res) => {
  const plan = await SubscriptionPlan.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!plan) throw ApiError.notFound('Plan not found');
  sendResponse(res, 200, 'Plan updated', { plan });
});

function addCycle(date, cycle) {
  const d = new Date(date);
  if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

// POST /subscriptions/salon/subscribe  { planId, salonId, razorpayPaymentId? }  (owner)
exports.salonSubscribe = asyncHandler(async (req, res) => {
  const { planId, salonId } = req.body;
  const plan = await SubscriptionPlan.findById(planId);
  if (!plan || plan.audience !== 'salon') throw ApiError.badRequest('Invalid salon plan');
  const salon = await Salon.findById(salonId);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw ApiError.forbidden('Not your salon');
  }

  const endDate = addCycle(Date.now(), plan.billingCycle);
  const sub = await Subscription.create({
    audience: 'salon', plan: plan._id, planKey: plan.key, salon: salon._id,
    price: plan.price, endDate, razorpayPaymentId: req.body.razorpayPaymentId,
  });
  salon.subscriptionPlan = plan.key;
  salon.subscriptionExpiry = endDate;
  await salon.save();
  sendResponse(res, 201, `Subscribed to ${plan.name}`, { subscription: sub });
});

// POST /subscriptions/pass/buy  { planId, razorpayPaymentId? }  (customer)
exports.buyPass = asyncHandler(async (req, res) => {
  const plan = await SubscriptionPlan.findById(req.body.planId);
  if (!plan || plan.audience !== 'customer') throw ApiError.badRequest('Invalid customer pass');
  const endDate = addCycle(Date.now(), plan.billingCycle);
  const sub = await Subscription.create({
    audience: 'customer', plan: plan._id, planKey: plan.key, user: req.user._id,
    price: plan.price, endDate, razorpayPaymentId: req.body.razorpayPaymentId,
  });
  sendResponse(res, 201, `${plan.name} activated`, { subscription: sub });
});

// GET /subscriptions/mine  (customer or owner)
exports.mine = asyncHandler(async (req, res) => {
  const filter = req.query.salonId
    ? { salon: req.query.salonId }
    : { user: req.user._id };
  const subs = await Subscription.find(filter).populate('plan', 'name price features').sort({ createdAt: -1 });
  sendResponse(res, 200, 'Subscriptions', { subscriptions: subs });
});

// PATCH /subscriptions/:id/cancel
exports.cancel = asyncHandler(async (req, res) => {
  const sub = await Subscription.findById(req.params.id);
  if (!sub) throw ApiError.notFound('Subscription not found');
  const ownsCustomer = sub.user && sub.user.toString() === req.user._id.toString();
  let ownsSalon = false;
  if (sub.salon) {
    const salon = await Salon.findById(sub.salon);
    ownsSalon = salon && salon.owner.toString() === req.user._id.toString();
  }
  if (!ownsCustomer && !ownsSalon && req.user.role !== 'admin') throw ApiError.forbidden('Not allowed');
  sub.status = 'cancelled';
  sub.autoRenew = false;
  await sub.save();
  sendResponse(res, 200, 'Subscription cancelled', { subscription: sub });
});
