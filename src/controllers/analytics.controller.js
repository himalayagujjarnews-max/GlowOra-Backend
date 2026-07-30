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
