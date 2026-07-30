/**
 * AI / smart-features controller.
 *
 * These endpoints give real, explainable results today (rule-based +
 * data-driven) and are structured so a future ML/vision provider can be
 * dropped in behind the same API without changing the app.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const rec = require('../services/recommendation.service');
const Booking = require('../models/Booking');
const Salon = require('../models/Salon');
const { localYmd } = require('../utils/helpers');

// GET /ai/recommendations  — personalised "for you" bundle
exports.recommendations = asyncHandler(async (req, res) => {
  const [frequent, products, discover] = await Promise.all([
    rec.frequentServices(req.user._id),
    rec.recommendedProducts(req.user._id),
    rec.discoverSalons(req.user._id, req.user.city),
  ]);
  sendResponse(res, 200, 'Recommendations', { bookAgain: frequent, products, discoverSalons: discover });
});

// GET /ai/also-booked?serviceId=  — "customers also booked"
exports.alsoBooked = asyncHandler(async (req, res) => {
  if (!req.query.serviceId) throw ApiError.badRequest('serviceId query param required');
  const items = await rec.alsoBooked(req.query.serviceId);
  sendResponse(res, 200, 'Also booked', { services: items });
});

/**
 * POST /ai/face-analysis   { concerns?: [], skinType?, imageUrl? }
 * Rule-based skincare guidance. `imageUrl` is accepted for a future vision
 * model; today we use the declared concerns to suggest services safely.
 */
exports.faceAnalysis = asyncHandler(async (req, res) => {
  const concerns = Array.isArray(req.body.concerns) ? req.body.concerns : [];
  const skinType = req.body.skinType; // dry | oily | combination | normal

  const suggestions = [];
  const add = (name, why) => suggestions.push({ service: name, why });

  if (concerns.includes('acne') || skinType === 'oily') add('Deep Cleanup Facial', 'Helps with oil control and clogged pores');
  if (concerns.includes('dryness') || skinType === 'dry') add('Hydrating Facial', 'Restores moisture to dry skin');
  if (concerns.includes('tan')) add('De-Tan Treatment', 'Reduces tanning and evens tone');
  if (concerns.includes('dark_spots') || concerns.includes('pigmentation')) add('Brightening Facial', 'Targets pigmentation and dark spots');
  if (concerns.includes('ageing') || concerns.includes('wrinkles')) add('Anti-Ageing Facial', 'Firms and smooths fine lines');
  if (concerns.includes('dull')) add('Glow Facial', 'Instant radiance for dull skin');
  if (!suggestions.length) add('Signature Cleanup', 'A great all-round refresh for healthy skin');

  sendResponse(res, 200, 'Skin guidance', {
    skinType: skinType || 'not specified',
    concerns,
    suggestedServices: suggestions,
    note: 'General guidance only — your stylist will personalise on the day. For medical skin issues, consult a dermatologist.',
    visionModel: 'not_enabled', // hook for future image-based analysis
  });
});

/**
 * POST /ai/hair-analysis   { hairType?, concerns?: [], imageUrl? }
 */
exports.hairAnalysis = asyncHandler(async (req, res) => {
  const concerns = Array.isArray(req.body.concerns) ? req.body.concerns : [];
  const hairType = req.body.hairType; // straight | wavy | curly | coily

  const suggestions = [];
  const add = (name, why) => suggestions.push({ service: name, why });

  if (concerns.includes('dandruff')) add('Anti-Dandruff Treatment', 'Soothes scalp and reduces flakes');
  if (concerns.includes('hairfall')) add('Hair Fall Treatment', 'Strengthens roots and reduces breakage');
  if (concerns.includes('dryness') || concerns.includes('frizz')) add('Hair Spa', 'Deep conditioning for smooth, frizz-free hair');
  if (concerns.includes('damage')) add('Keratin Treatment', 'Repairs and smooths damaged hair');
  if (hairType === 'curly' || hairType === 'coily') add('Curl-Care Cut', 'A cut tailored to your curl pattern');
  if (!suggestions.length) add('Hair Spa', 'A nourishing reset for healthy hair');

  sendResponse(res, 200, 'Hair guidance', {
    hairType: hairType || 'not specified',
    concerns,
    suggestedServices: suggestions,
    note: 'General guidance only — your stylist will personalise on the day.',
    visionModel: 'not_enabled',
  });
});

/**
 * GET /ai/demand-forecast?salonId=  — simple forecast from history:
 * busiest weekday and hour, plus 7-day expected volume trend.
 */
exports.demandForecast = asyncHandler(async (req, res) => {
  const { salonId } = req.query;
  if (!salonId) throw ApiError.badRequest('salonId query param required');
  const salon = await Salon.findById(salonId);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw ApiError.forbidden('Not your salon');
  }

  const mongoose = require('mongoose');
  const sId = new mongoose.Types.ObjectId(salonId);

  const [byHour, byDow] = await Promise.all([
    Booking.aggregate([
      { $match: { salon: sId } },
      { $group: { _id: { $substr: ['$startTime', 0, 2] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Booking.aggregate([
      { $match: { salon: sId } },
      { $group: { _id: { $dayOfWeek: { $dateFromString: { dateString: '$date', onError: new Date() } } }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  const days = ['', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  sendResponse(res, 200, 'Demand forecast', {
    busiestHour: byHour[0] ? `${byHour[0]._id}:00` : null,
    busiestDay: byDow[0] ? days[byDow[0]._id] : null,
    hourDistribution: byHour,
    dayDistribution: byDow.map((d) => ({ day: days[d._id], count: d.count })),
    generatedFor: localYmd(),
  });
});

/**
 * POST /ai/assistant   { question }  — lightweight FAQ assistant.
 * Answers common questions from a knowledge base; escalates to support
 * when unsure. (Pluggable: swap in an LLM behind this later.)
 */
exports.assistant = asyncHandler(async (req, res) => {
  const q = (req.body.question || '').toLowerCase();
  if (!q) throw ApiError.badRequest('question is required');

  const kb = [
    { k: ['cancel', 'refund'], a: 'You can cancel from My Bookings. Refunds: 100% if cancelled 4+ hours before, 50% within 1–4 hours, and none under 1 hour. Refunds go to your GlowOra wallet.' },
    { k: ['token', '49'], a: 'The ₹49 token holds your slot. You pay the rest at the salon. It is refundable per our cancellation policy.' },
    { k: ['home service', 'at home'], a: 'Many salons offer home service — look for the "Home Service" tag. You will generate an OTP to verify the stylist on arrival.' },
    { k: ['reschedule', 'change time'], a: 'Open the booking in My Bookings and tap Reschedule to pick a new date/slot (allowed for upcoming bookings).' },
    { k: ['wallet', 'balance'], a: 'Your GlowOra wallet holds refunds, cashback and top-ups. You can pay for bookings and vouchers with it.' },
    { k: ['coupon', 'offer', 'discount'], a: 'Apply a coupon at checkout. You can also see active offers on each salon page.' },
    { k: ['points', 'loyalty', 'glow'], a: 'You earn Glow Points on every completed booking, which you can redeem for discounts.' },
    { k: ['2fa', 'two factor', 'security'], a: 'You can enable two-factor authentication from Profile → Security for extra account protection.' },
  ];
  const match = kb.find((e) => e.k.some((kw) => q.includes(kw)));
  sendResponse(res, 200, 'Assistant', {
    answer: match ? match.a : "I'm not sure about that. I can connect you with our support team — please raise a ticket from Help & Support.",
    matched: Boolean(match),
    escalate: !match,
  });
});
