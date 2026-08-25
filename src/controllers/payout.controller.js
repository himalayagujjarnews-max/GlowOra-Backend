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
const Staff = require('../models/Staff');

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

// POST /payouts   { salon, amount, ... } OR { staff, amount, ... }  (admin)
// Manual, offline payout record — admin has already transferred the money
// themselves and is just logging it. This is now the FALLBACK path; the
// normal path is the automated T+1 wallet settlement job (see
// scheduler.service.js `runWalletSettlement`), which creates its own Payout
// docs with source: 'wallet_settlement'.
exports.create = asyncHandler(async (req, res) => {
  const { salon, staff, amount } = req.body;
  if (amount == null) throw ApiError.badRequest('amount is required');
  if (!salon && !staff) throw ApiError.badRequest('salon or staff is required');
  const recipientType = staff ? 'staff' : 'salon';
  const payout = await Payout.create({
    ...req.body,
    recipientType,
    status: 'paid',
    source: 'manual',
    processedAt: new Date(),
    processedBy: req.user._id,
  });

  // Staff payouts are a straightforward manual record — no linked bookings
  // to reconcile against (that reconciliation only applies to salon payouts,
  // handled below).
  if (recipientType === 'staff') {
    return sendResponse(res, 201, 'Payout recorded', { payout });
  }

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

// GET /payouts/mine   (owner or staff — resolves whichever wallet they own)
exports.mine = asyncHandler(async (req, res) => {
  if (req.user.role === 'staff') {
    const staffDocs = await Staff.find({ user: req.user._id }).select('_id');
    const payouts = await Payout.find({ recipientType: 'staff', staff: { $in: staffDocs.map((s) => s._id) } }).sort({ createdAt: -1 });
    return sendResponse(res, 200, 'Payouts', { payouts });
  }
  const salons = await Salon.find({ owner: req.user._id }).select('_id');
  const payouts = await Payout.find({ recipientType: 'salon', salon: { $in: salons.map((s) => s._id) } }).populate('salon', 'name').sort({ createdAt: -1 });
  sendResponse(res, 200, 'Payouts', { payouts });
});

// PATCH /payouts/:id  { status, reference? }  (admin)
// Admin confirms a 'processing' automated settlement actually landed in the
// recipient's bank account (or mark it 'failed' if the transfer bounced —
// e.g. bad IFSC — so the money can be manually reconciled/re-credited).
exports.updateStatus = asyncHandler(async (req, res) => {
  const { status, reference } = req.body;
  if (!['paid', 'failed'].includes(status)) throw ApiError.badRequest('status must be paid or failed');
  const payout = await Payout.findById(req.params.id);
  if (!payout) throw ApiError.notFound('Payout not found');
  payout.status = status;
  if (reference) payout.reference = reference;
  payout.processedAt = new Date();
  payout.processedBy = req.user._id;
  await payout.save();
  sendResponse(res, 200, `Payout marked ${status}`, { payout });
});

// GET /payouts   (admin — all)
exports.adminList = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.recipientType) filter.recipientType = req.query.recipientType;
  const payouts = await Payout.find(filter)
    .populate('salon', 'name address.city')
    .populate('staff', 'name')
    .sort({ createdAt: -1 });
  sendResponse(res, 200, 'Payouts', { payouts });
});
