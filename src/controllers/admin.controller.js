/**
 * Admin controller — dashboard stats, reports, and push broadcast.
 */
const asyncHandler = require('../utils/asyncHandler');
const sendResponse = require('../utils/ApiResponse');
const User = require('../models/User');
const Salon = require('../models/Salon');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const AuditLog = require('../models/AuditLog');
const { escapeRegex } = require('../utils/helpers');
const LoginHistory = require('../models/LoginHistory');
const { getPagination, buildMeta } = require('../utils/pagination');
const { broadcast } = require('../services/notification.service');

// GET /admin/stats
exports.stats = asyncHandler(async (req, res) => {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [customers, salonsActive, salonsPending, bookingsMonth, revenueAgg, commissionAgg] = await Promise.all([
    User.countDocuments({ role: 'customer' }),
    Salon.countDocuments({ status: 'active' }),
    Salon.countDocuments({ status: 'pending' }),
    Booking.countDocuments({ createdAt: { $gte: monthStart } }),
    Booking.aggregate([{ $match: { status: 'completed', completedAt: { $gte: monthStart } } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
    Booking.aggregate([{ $match: { status: 'completed', completedAt: { $gte: monthStart } } }, { $group: { _id: null, total: { $sum: '$commission' } } }]),
  ]);

  sendResponse(res, 200, 'Dashboard stats', {
    customers,
    salonsActive,
    salonsPending,
    bookingsThisMonth: bookingsMonth,
    revenueThisMonth: revenueAgg[0]?.total || 0,
    commissionThisMonth: commissionAgg[0]?.total || 0,
  });
});

// GET /admin/reports/bookings-trend   (last 7 months counts)
exports.bookingsTrend = asyncHandler(async (req, res) => {
  const agg = await Booking.aggregate([
    { $group: { _id: { $substr: ['$date', 0, 7] }, count: { $sum: 1 }, revenue: { $sum: '$total' } } },
    { $sort: { _id: 1 } },
    { $limit: 12 },
  ]);
  sendResponse(res, 200, 'Bookings trend', { trend: agg });
});

// GET /admin/reports/bookings-by-city
exports.bookingsByCity = asyncHandler(async (req, res) => {
  const agg = await Booking.aggregate([
    { $lookup: { from: 'salons', localField: 'salon', foreignField: '_id', as: 's' } },
    { $unwind: '$s' },
    { $group: { _id: '$s.address.city', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  sendResponse(res, 200, 'Bookings by city', { cities: agg });
});

// GET /admin/audit-logs?action=&actor=&page=
exports.auditLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};
  if (req.query.action) filter.action = new RegExp(escapeRegex(req.query.action), 'i');
  if (req.query.actor) filter.actor = req.query.actor;
  const [logs, total] = await Promise.all([
    AuditLog.find(filter).populate('actor', 'name phone role').sort({ createdAt: -1 }).skip(skip).limit(limit),
    AuditLog.countDocuments(filter),
  ]);
  sendResponse(res, 200, 'Audit logs', { logs }, buildMeta(page, limit, total));
});

// GET /admin/login-history?suspicious=&page=
exports.loginHistory = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};
  if (req.query.suspicious === 'true') filter.suspicious = true;
  if (req.query.success === 'false') filter.success = false;
  const [history, total] = await Promise.all([
    LoginHistory.find(filter).populate('user', 'name phone').sort({ createdAt: -1 }).skip(skip).limit(limit),
    LoginHistory.countDocuments(filter),
  ]);
  sendResponse(res, 200, 'Login history', { history }, buildMeta(page, limit, total));
});

// POST /admin/broadcast   { title, body, target, city }
exports.broadcast = asyncHandler(async (req, res) => {
  const { title, body, target, city } = req.body;
  const filter = {};
  if (target === 'customers') filter.role = 'customer';
  else if (target === 'owners') filter.role = 'owner';
  if (city) filter.city = city;
  const result = await broadcast({ filter, title, body, type: 'promo' });
  sendResponse(res, 200, 'Broadcast sent', result);
});

// GET /admin/bookings?status=&search=&limit=  (admin — flat list for admin table view)
exports.bookings = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
  const bookings = await Booking.find(filter)
    .populate('salon', 'name address')
    .populate('customer', 'name phone')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  sendResponse(res, 200, 'Bookings', { count: bookings.length, bookings });
});

// GET /admin/reports/export/bookings.csv?from=&to=
exports.exportBookingsCsv = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.from || req.query.to) {
    filter.date = {};
    if (req.query.from) filter.date.$gte = req.query.from;
    if (req.query.to) filter.date.$lte = req.query.to;
  }
  const bookings = await Booking.find(filter).populate('salon', 'name').populate('customer', 'name phone').limit(5000).lean();
  const header = 'BookingCode,Date,Time,Customer,Phone,Salon,Total,Commission,Status,PaymentMode\n';
  const rows = bookings.map((b) =>
    [b.bookingCode, b.date, b.startTime, b.customer?.name || '', b.customer?.phone || '',
     (b.salon?.name || '').replace(/,/g, ' '), b.total, b.commission, b.status, b.paymentMode].join(',')
  );
  res.header('Content-Type', 'text/csv');
  res.attachment('bookings.csv');
  res.send(header + rows.join('\n'));
});

// GET /admin/reports/summary
exports.summary = asyncHandler(async (req, res) => {
  const [totalBookings, completed, cancelled, avgRatingAgg, newUsers] = await Promise.all([
    Booking.countDocuments(),
    Booking.countDocuments({ status: 'completed' }),
    Booking.countDocuments({ status: 'cancelled' }),
    Salon.aggregate([{ $match: { reviewCount: { $gt: 0 } } }, { $group: { _id: null, avg: { $avg: '$rating' } } }]),
    User.countDocuments({ createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }),
  ]);
  const completionRate = totalBookings ? Math.round((completed / totalBookings) * 100) : 0;
  sendResponse(res, 200, 'Summary', {
    totalBookings, completed, cancelled, completionRate,
    avgRating: Math.round((avgRatingAgg[0]?.avg || 0) * 10) / 10,
    newUsersLast30d: newUsers,
  });
});
