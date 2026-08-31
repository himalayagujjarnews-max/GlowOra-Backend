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
const Payment = require('../models/Payment');
const rp = require('../config/razorpay');

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

// POST /subscriptions/pass/create-order  { planId }  (customer)
// Step 1 of the real payment flow — creates a Razorpay order for the plan
// price and records a pending Payment. Mirrors wallet.controller.js's
// createTopupOrder pattern: amount is fixed server-side from the plan, never
// trusted from the client, so it can't be tampered with at verify time.
exports.createPassOrder = asyncHandler(async (req, res) => {
  const plan = await SubscriptionPlan.findById(req.body.planId);
  if (!plan || plan.audience !== 'customer') throw ApiError.badRequest('Invalid customer pass');

  // Free plans (price 0) skip payment entirely and activate immediately.
  if (!plan.price || plan.price <= 0) {
    const endDate = addCycle(Date.now(), plan.billingCycle);
    const sub = await Subscription.create({
      audience: 'customer', plan: plan._id, planKey: plan.key, user: req.user._id,
      price: 0, endDate,
    });
    return sendResponse(res, 201, `${plan.name} activated`, { subscription: sub, free: true });
  }

  const order = await rp.createOrder({
    amount: plan.price,
    receipt: `pass_${req.user._id}_${Date.now()}`,
    notes: { type: 'subscription_pass', user: req.user._id.toString(), planId: plan._id.toString() },
  });
  const payment = await Payment.create({
    customer: req.user._id, amount: plan.price, type: 'subscription',
    razorpayOrderId: order.id, status: 'created', notes: { planId: plan._id.toString() },
  });
  sendResponse(res, 201, 'Order created', {
    orderId: order.id, amount: plan.price, keyId: rp.keyId || 'mock',
    paymentId: payment._id, mock: order.mock || false,
  });
});

// POST /subscriptions/pass/verify  { razorpayOrderId, razorpayPaymentId, razorpaySignature }
// Step 2 — only activates the Subscription after the Razorpay signature is
// verified, using the plan/amount from the server-side Payment record (not
// anything the client sends), so a customer can't spoof a "successful"
// purchase and get the pass for free.
exports.verifyPass = asyncHandler(async (req, res) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
  if (!razorpayOrderId || !razorpayPaymentId) throw ApiError.badRequest('Missing payment fields');

  const valid = rp.verifyPaymentSignature({
    orderId: razorpayOrderId, paymentId: razorpayPaymentId, signature: razorpaySignature,
  });
  if (!valid) throw ApiError.badRequest('Payment signature verification failed');

  const payment = await Payment.findOne({ razorpayOrderId, customer: req.user._id, type: 'subscription' });
  if (!payment) throw ApiError.notFound('Pass order not found');
  if (payment.status === 'paid') throw ApiError.badRequest('This purchase has already been processed');

  const plan = await SubscriptionPlan.findById(payment.notes?.planId);
  if (!plan) throw ApiError.notFound('Plan not found');

  payment.razorpayPaymentId = razorpayPaymentId;
  payment.razorpaySignature = razorpaySignature;
  payment.status = 'paid';
  await payment.save();

  const endDate = addCycle(Date.now(), plan.billingCycle);
  const sub = await Subscription.create({
    audience: 'customer', plan: plan._id, planKey: plan.key, user: req.user._id,
    price: plan.price, endDate, razorpayPaymentId,
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
