/**
 * Analytics controller — salon owner dashboard, popular services, peak hours,
 * customer retention, staff performance, revenue trend, and invoice data.
 */
const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const Booking = require('../models/Booking');
const Salon = require('../models/Salon');
const Staff = require('../models/Staff');
const { localYmd } = require('../utils/helpers');

async function assertOwns(user, salonId) {
  const salon = await Salon.findById(salonId);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== user._id.toString() && user.role !== 'admin') {
    throw ApiError.forbidden('Not your salon');
  }
  return salon;
}
const oid = (id) => new mongoose.Types.ObjectId(id);

// GET /analytics/:salonId/dashboard
exports.dashboard = asyncHandler(async (req, res) => {
  const salon = await assertOwns(req.user, req.params.salonId);
  const today = localYmd(); // timezone-aware calendar day
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [todayCount, pending, monthAgg, ratingInfo] = await Promise.all([
    Booking.countDocuments({ salon: salon._id, date: today }),
    Booking.countDocuments({ salon: salon._id, status: 'pending' }),
    Booking.aggregate([
      { $match: { salon: salon._id, status: 'completed', completedAt: { $gte: monthStart } } },
      { $group: { _id: null, revenue: { $sum: '$total' }, payout: { $sum: '$salonPayout' }, count: { $sum: 1 } } },
    ]),
    Promise.resolve({ rating: salon.rating, reviewCount: salon.reviewCount }),
  ]);

  sendResponse(res, 200, 'Salon dashboard', {
    todayBookings: todayCount,
    pendingBookings: pending,
    monthRevenue: monthAgg[0]?.revenue || 0,
    monthPayout: monthAgg[0]?.payout || 0,
    monthBookings: monthAgg[0]?.count || 0,
    rating: ratingInfo.rating,
    reviewCount: ratingInfo.reviewCount,
  });
});

// GET /analytics/:salonId/popular-services
exports.popularServices = asyncHandler(async (req, res) => {
  const salon = await assertOwns(req.user, req.params.salonId);
  const agg = await Booking.aggregate([
    { $match: { salon: salon._id, status: 'completed' } },
    { $unwind: '$services' },
    { $group: { _id: '$services.name', count: { $sum: 1 }, revenue: { $sum: '$services.price' } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);
  sendResponse(res, 200, 'Popular services', { services: agg });
});

// GET /analytics/:salonId/peak-hours
exports.peakHours = asyncHandler(async (req, res) => {
  const salon = await assertOwns(req.user, req.params.salonId);
  const agg = await Booking.aggregate([
    { $match: { salon: salon._id } },
    { $group: { _id: { $substr: ['$startTime', 0, 2] }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  sendResponse(res, 200, 'Peak hours', { hours: agg });
});

// GET /analytics/:salonId/slow-periods — "smart offers" input: which
// day-of-week + time-of-day buckets are consistently low-volume for THIS
// salon, over the last ~60 days. Bucketing is deliberately simple (day-of-week
// from booking.date, morning/afternoon/evening from booking.startTime) — no
// ML, just an average-bookings-per-occurrence comparison so the owner gets a
// "your Tuesday afternoons are slow" nudge to create a happy-hour offer.
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOUR_BUCKETS = [
  { key: 'morning', label: 'mornings', from: 0, to: 12 },
  { key: 'afternoon', label: 'afternoons', from: 12, to: 17 },
  { key: 'evening', label: 'evenings', from: 17, to: 24 },
];
function hourBucketFor(startTime) {
  const hour = parseInt(String(startTime || '00:00').slice(0, 2), 10) || 0;
  return HOUR_BUCKETS.find((b) => hour >= b.from && hour < b.to) || HOUR_BUCKETS[0];
}

exports.suggestSlowPeriods = asyncHandler(async (req, res) => {
  const salon = await assertOwns(req.user, req.params.salonId);
  const since = new Date();
  since.setDate(since.getDate() - 60);
  const sinceYmd = since.toISOString().slice(0, 10);

  const bookings = await Booking.find({
    salon: salon._id,
    status: { $ne: 'cancelled' },
    date: { $gte: sinceYmd },
  }).select('date startTime');

  // how many times each day-of-week actually occurred in the window, so the
  // "average bookings" denominator is fair (e.g. ~8-9 Tuesdays in 60 days).
  const dowOccurrences = new Array(7).fill(0);
  for (let d = new Date(since); d <= new Date(); d.setDate(d.getDate() + 1)) {
    dowOccurrences[d.getDay()] += 1;
  }

  // sum bookings per (dayOfWeek, hourBucket) combo
  const comboCounts = {}; // `${dow}_${bucketKey}` -> count
  for (const b of bookings) {
    const dow = new Date(`${b.date}T00:00:00`).getDay();
    const bucket = hourBucketFor(b.startTime);
    const key = `${dow}_${bucket.key}`;
    comboCounts[key] = (comboCounts[key] || 0) + 1;
  }

  // build every combo (even zero-booking ones) so genuinely dead slots surface too
  const combos = [];
  for (let dow = 0; dow < 7; dow += 1) {
    for (const bucket of HOUR_BUCKETS) {
      const key = `${dow}_${bucket.key}`;
      const count = comboCounts[key] || 0;
      const occurrences = dowOccurrences[dow] || 1;
      combos.push({
        dayOfWeek: dow,
        hourBucket: bucket.key,
        label: `${DAY_NAMES[dow]} ${bucket.label}`,
        avgBookings: Math.round((count / occurrences) * 100) / 100,
      });
    }
  }

  combos.sort((a, b) => a.avgBookings - b.avgBookings);
  const N = 3;
  sendResponse(res, 200, 'Slow periods', { slowPeriods: combos.slice(0, N) });
});

// GET /analytics/:salonId/retention
exports.retention = asyncHandler(async (req, res) => {
  const salon = await assertOwns(req.user, req.params.salonId);
  const agg = await Booking.aggregate([
    { $match: { salon: salon._id, status: 'completed' } },
    { $group: { _id: '$customer', visits: { $sum: 1 } } },
    { $group: { _id: null, total: { $sum: 1 }, repeat: { $sum: { $cond: [{ $gt: ['$visits', 1] }, 1, 0] } } } },
  ]);
  const total = agg[0]?.total || 0;
  const repeat = agg[0]?.repeat || 0;
  sendResponse(res, 200, 'Customer retention', {
    totalCustomers: total,
    repeatCustomers: repeat,
    retentionRate: total ? Math.round((repeat / total) * 100) : 0,
  });
});

// GET /analytics/:salonId/staff-performance
exports.staffPerformance = asyncHandler(async (req, res) => {
  const salon = await assertOwns(req.user, req.params.salonId);
  const agg = await Booking.aggregate([
    { $match: { salon: salon._id, status: 'completed' } },
    { $group: { _id: '$staff', bookings: { $sum: 1 }, revenue: { $sum: '$total' }, tips: { $sum: '$tip' } } },
    { $sort: { revenue: -1 } },
  ]);
  const staff = await Staff.find({ salon: salon._id }).select('name');
  const map = Object.fromEntries(staff.map((s) => [s._id.toString(), s.name]));
  const result = agg.map((a) => ({ staff: a._id, name: map[a._id?.toString()] || 'Unknown', bookings: a.bookings, revenue: a.revenue, tips: a.tips }));
  sendResponse(res, 200, 'Staff performance', { staff: result });
});

// GET /analytics/:salonId/commissions?from=&to=  — staff commission owed for
// a date range (default: this calendar month), for the owner to see who's
// owed what. Grouped/summed server-side same as staffPerformance above.
exports.commissions = asyncHandler(async (req, res) => {
  const salon = await assertOwns(req.user, req.params.salonId);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const from = req.query.from ? new Date(req.query.from) : monthStart;
  const to = req.query.to ? new Date(req.query.to) : new Date();

  const agg = await Booking.aggregate([
    { $match: { salon: salon._id, status: 'completed', completedAt: { $gte: from, $lte: to } } },
    { $group: { _id: '$staff', bookings: { $sum: 1 }, commissionAmount: { $sum: '$commissionAmount' } } },
    { $sort: { commissionAmount: -1 } },
  ]);
  const staff = await Staff.find({ salon: salon._id }).select('name');
  const map = Object.fromEntries(staff.map((s) => [s._id.toString(), s.name]));
  const result = agg.map((a) => ({ staff: a._id, name: map[a._id?.toString()] || 'Unknown', bookings: a.bookings, commissionAmount: a.commissionAmount }));
  sendResponse(res, 200, 'Staff commissions', { from, to, staff: result });
});

// GET /analytics/:salonId/revenue-trend
exports.revenueTrend = asyncHandler(async (req, res) => {
  const salon = await assertOwns(req.user, req.params.salonId);
  const agg = await Booking.aggregate([
    { $match: { salon: salon._id, status: 'completed' } },
    { $group: { _id: { $substr: ['$date', 0, 7] }, revenue: { $sum: '$total' }, bookings: { $sum: 1 } } },
    { $sort: { _id: 1 } },
    { $limit: 12 },
  ]);
  sendResponse(res, 200, 'Revenue trend', { trend: agg });
});

// GET /analytics/invoice/:bookingId  — invoice/receipt data (customer or salon)
exports.invoice = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.bookingId).populate('salon', 'name address gstNumber').populate('staff', 'name');
  if (!booking) throw ApiError.notFound('Booking not found');
  const salon = await Salon.findById(booking.salon._id).select('owner');
  const isCustomer = booking.customer.toString() === req.user._id.toString();
  const isOwner = salon.owner.toString() === req.user._id.toString();
  if (!isCustomer && !isOwner && req.user.role !== 'admin') throw ApiError.forbidden('Not allowed');

  sendResponse(res, 200, 'Invoice', {
    invoice: {
      bookingCode: booking.bookingCode,
      date: booking.date,
      time: booking.startTime,
      salon: booking.salon.name,
      gstNumber: booking.salon.gstNumber,
      stylist: booking.staff?.name,
      services: booking.services,
      subtotal: booking.subtotal,
      discount: booking.discount,
      total: booking.total,
      tip: booking.tip,
      amountPaid: booking.amountPaid,
      amountDue: booking.amountDue,
      paymentMode: booking.paymentMode,
      status: booking.status,
    },
  });
});
