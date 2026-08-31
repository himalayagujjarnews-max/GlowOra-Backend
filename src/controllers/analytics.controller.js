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
const Shift = require('../models/Shift');
const Service = require('../models/Service');
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

// GET /analytics/:salonId/peak-hours-heatmap — same idea as peak-hours but
// broken down by day-of-week too, for a proper day x hour heatmap in the UI
// (peak-hours above stays hour-only, kept for backward compat with any
// existing caller). `date` is stored as 'YYYY-MM-DD' so day-of-week is
// derived with $dayOfWeek (1=Sun..7=Sat, Mongo's convention).
exports.peakHoursHeatmap = asyncHandler(async (req, res) => {
  const salon = await assertOwns(req.user, req.params.salonId);
  const agg = await Booking.aggregate([
    { $match: { salon: salon._id, status: { $ne: 'cancelled' } } },
    {
      $group: {
        _id: {
          // onError/onNull guard against any malformed `date` string blowing up
          // the whole aggregation — those bookings just get excluded (_id.dayOfWeek: null).
          dayOfWeek: { $subtract: [{ $dayOfWeek: { $dateFromString: { dateString: '$date', onError: null, onNull: null } } }, 1] },
          hour: { $substr: ['$startTime', 0, 2] },
        },
        count: { $sum: 1 },
      },
    },
  ]);
  const cells = agg.map((a) => ({ dayOfWeek: a._id.dayOfWeek, hour: parseInt(a._id.hour, 10), count: a.count }));
  sendResponse(res, 200, 'Peak hours heatmap', { cells });
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

// GET /analytics/:salonId/staff-utilization — booked hours vs. available
// (shift) hours per staff over the last 30 days. Available hours are
// derived from the weekly Shift roster (staff.shift.controller.js/Shift.js)
// projected across the window; if a staff member has no shifts configured
// at all, we report utilization as null (unknown) rather than dividing by
// zero or silently assuming they're available 24/7.
exports.staffUtilization = asyncHandler(async (req, res) => {
  const salon = await assertOwns(req.user, req.params.salonId);
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const [bookedAgg, shifts, staffList] = await Promise.all([
    Booking.aggregate([
      { $match: { salon: salon._id, status: 'completed', completedAt: { $gte: since }, staff: { $ne: null } } },
      { $unwind: '$services' },
      { $group: { _id: '$staff', bookedMinutes: { $sum: '$services.durationMinutes' } } },
    ]),
    Shift.find({ salon: salon._id }),
    Staff.find({ salon: salon._id }).select('name'),
  ]);

  const bookedByStaff = Object.fromEntries(bookedAgg.map((b) => [b._id.toString(), b.bookedMinutes || 0]));

  // weekly available minutes per staff, from non-off shifts
  const weeklyMinutesByStaff = {};
  for (const s of shifts) {
    if (s.isOff || !s.startTime || !s.endTime) continue;
    const [sh, sm] = s.startTime.split(':').map(Number);
    const [eh, em] = s.endTime.split(':').map(Number);
    const minutes = Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
    const key = s.staff.toString();
    weeklyMinutesByStaff[key] = (weeklyMinutesByStaff[key] || 0) + minutes;
  }

  const result = staffList.map((st) => {
    const key = st._id.toString();
    const bookedMinutes = bookedByStaff[key] || 0;
    const hasShifts = weeklyMinutesByStaff[key] > 0;
    // 30-day window ≈ 30/7 weeks of the configured weekly availability
    const availableMinutes = hasShifts ? Math.round(weeklyMinutesByStaff[key] * (30 / 7)) : 0;
    return {
      staff: st._id,
      name: st.name,
      bookedHours: Math.round((bookedMinutes / 60) * 10) / 10,
      availableHours: hasShifts ? Math.round((availableMinutes / 60) * 10) / 10 : null,
      utilizationPercent: hasShifts ? Math.min(100, Math.round((bookedMinutes / availableMinutes) * 100)) : null,
    };
  });

  sendResponse(res, 200, 'Staff utilization', { staff: result });
});

// GET /analytics/:salonId/service-margin — revenue and profit margin per
// service, over completed bookings. Margin is only computed for services
// the owner has set a costPrice on (Service.costPrice, added specifically
// for this feature) — services without one show margin: null rather than a
// misleading 100%/0% guess.
exports.serviceMargin = asyncHandler(async (req, res) => {
  const salon = await assertOwns(req.user, req.params.salonId);
  const [agg, services] = await Promise.all([
    Booking.aggregate([
      { $match: { salon: salon._id, status: 'completed' } },
      { $unwind: '$services' },
      { $match: { 'services.service': { $ne: null } } },
      { $group: { _id: '$services.service', count: { $sum: 1 }, revenue: { $sum: '$services.price' } } },
    ]),
    Service.find({ salon: salon._id }).select('name costPrice price'),
  ]);
  const serviceById = Object.fromEntries(services.map((s) => [s._id.toString(), s]));

  const result = agg.map((a) => {
    const svc = serviceById[a._id?.toString()];
    const hasCost = svc && svc.costPrice != null;
    const avgPrice = a.count ? a.revenue / a.count : 0;
    const marginPercent = hasCost && avgPrice > 0
      ? Math.round(((avgPrice - svc.costPrice) / avgPrice) * 100)
      : null;
    return {
      service: a._id,
      name: svc?.name || 'Unknown',
      count: a.count,
      revenue: a.revenue,
      marginPercent,
    };
  });
  result.sort((a, b) => b.revenue - a.revenue);
  sendResponse(res, 200, 'Service margin', { services: result });
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
