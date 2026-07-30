/**
 * Payout controller — computes and records salon payouts (admin), and lets
 * owners view their payout history.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const mongoose = require('mongoose');
const Payout = require('../models/Payout');
const Booking = require('../models/Booking');
const Salon = require('../models/Salon');

// GET /payouts/pending   (admin — aggregate unpaid completed bookings per salon)
exports.pending = asyncHandler(async (req, res) => {
  const agg = await Booking.aggregate([
    { $match: { status: 'completed', paidOut: { $ne: true } } },
    { $group: { _id: '$salon', bookings: { $sum: 1 }, gmv: { $sum: '$total' }, commission: { $sum: '$commission' }, payout: { $sum: '$salonPayout' } } },
    { $sort: { payout: -1 } },
  ]);
  const salonIds = agg.map((a) => a._id);
  const salons = await Salon.find({ _id: { $in: salonIds } }).select('name address.city');
  const map = Object.fromEntries(salons.map((s) => [s._id.toString(), s]));
  const result = agg.map((a) => ({
    salon: a._id,
    name: map[a._id.toString()]?.name || 'Unknown',
    city: map[a._id.toString()]?.address?.city,
    bookings: a.bookings, gmv: a.gmv, commission: a.commission, payout: a.payout,
  }));
  sendResponse(res, 200, 'Pending payouts', { payouts: result });
});

// POST /payouts   { salon, amount, bookingsCount, periodFrom, periodTo, method, reference }  (admin)
exports.create = asyncHandler(async (req, res) => {
  const { salon, amount } = req.body;
  if (!salon || amount == null) throw ApiError.badRequest('salon and amount are required');
  const payout = await Payout.create({
    ...req.body,
    status: 'paid',
    processedAt: new Date(),
    processedBy: req.user._id,
  });

  // Only mark outstanding bookings as paid out up to the amount actually paid.
  // Oldest-first, all-or-nothing per booking — never partially mark a booking.
  const outstanding = await Booking.find(
    { salon, status: 'completed', paidOut: { $ne: true } },
    { salonPayout: 1 }
  ).sort({ createdAt: 1 });

  const covered = [];
  let running = 0;
  for (const b of outstanding) {
    const next = running + (b.salonPayout || 0);
    if (next > amount) break;
    running = next;
    covered.push(b._id);
    if (running === amount) break;
  }

  if (covered.length) {
    await Booking.updateMany({ _id: { $in: covered } }, { $set: { paidOut: true } });
  }
  sendResponse(res, 201, 'Payout recorded', { payout });
});

// GET /payouts/mine   (owner)
exports.mine = asyncHandler(async (req, res) => {
  const salons = await Salon.find({ owner: req.user._id }).select('_id');
  const payouts = await Payout.find({ salon: { $in: salons.map((s) => s._id) } }).populate('salon', 'name').sort({ createdAt: -1 });
  sendResponse(res, 200, 'Payouts', { payouts });
});

// GET /payouts   (admin — all)
exports.adminList = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const payouts = await Payout.find(filter).populate('salon', 'name address.city').sort({ createdAt: -1 });
  sendResponse(res, 200, 'Payouts', { payouts });
});
