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
const logger = require('../utils/logger');
const { creditSalonWallet, creditStaffWallet, debitSalonWallet, debitStaffWallet } = require('./partnerWallet.controller');

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

  // Staff payouts are a straightforward manual record. The staff wallet may
  // hold this money already (credited via an owner transfer) — debit it now
  // so a later auto-settlement run doesn't try to pay the same amount out a
  // second time. Best-effort: if the wallet doesn't have (enough of) it —
  // e.g. admin is recording a payout for money that never passed through the
  // wallet at all — we still keep the payout record, just note it wasn't
  // backed by a wallet debit.
  if (recipientType === 'staff') {
    const newBalance = await debitStaffWallet(staff, amount, 'payout', `Manual payout ${payout._id}`, payout._id);
    if (newBalance === null) {
      logger.warn(`Manual staff payout ${payout._id}: wallet debit skipped (insufficient balance or staff not found) — recorded anyway`);
    }
    return sendResponse(res, 201, 'Payout recorded', { payout });
  }

  // Only mark outstanding bookings as paid out up to the amount actually paid.
  // Oldest-first, all-or-nothing per booking — never partially mark a booking.
  // Also track how much of the covered amount came from ONLINE-paid bookings
  // (paymentMode !== 'at_salon') — those are the ones that already credited
  // Salon.walletBalance (see booking.controller.js), so that portion must be
  // debited from the wallet here too, or the T+1 auto-settlement job will
  // pay it out again on top of this manual payout.
  const outstanding = await Booking.find(
    { salon, status: 'completed', paidOut: { $ne: true } },
    { salonPayout: 1, paymentMode: 1 }
  ).sort({ createdAt: 1 });

  const covered = [];
  let running = 0;
  let walletPortion = 0;
  for (const b of outstanding) {
    const next = running + (b.salonPayout || 0);
    if (next > amount) break;
    running = next;
    covered.push(b._id);
    if (b.paymentMode !== 'at_salon') walletPortion += b.salonPayout || 0;
    if (running === amount) break;
  }

  if (covered.length) {
    await Booking.updateMany({ _id: { $in: covered } }, { $set: { paidOut: true } });
  }
  if (walletPortion > 0) {
    const newBalance = await debitSalonWallet(salon, walletPortion, 'payout', `Manual payout ${payout._id}`, payout._id);
    if (newBalance === null) {
      logger.warn(`Manual payout ${payout._id}: wallet debit of ₹${walletPortion} skipped (insufficient balance) — recorded anyway`);
    }
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

  // A wallet_settlement payout already DEBITED the wallet the moment it was
  // created (see scheduler.service.js runWalletSettlement) — it was betting
  // the bank transfer would succeed. If it actually failed (bad IFSC,
  // account closed, etc.), that money is stuck nowhere unless we credit it
  // straight back to the same wallet so it's picked up by the next run.
  if (status === 'failed' && payout.status !== 'failed' && payout.source === 'wallet_settlement') {
    if (payout.recipientType === 'staff') {
      await creditStaffWallet(payout.staff, payout.amount, 'admin_adjust', `Reversed failed payout ${payout._id}`, payout._id);
    } else {
      await creditSalonWallet(payout.salon, payout.amount, 'admin_adjust', `Reversed failed payout ${payout._id}`, payout._id);
    }
  }

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
    .sort({ createdAt: -1 })
    .limit(500); // safety cap — admin-web's DataTable paginates client-side over whatever's returned
  sendResponse(res, 200, 'Payouts', { payouts });
});
