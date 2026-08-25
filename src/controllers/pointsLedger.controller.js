/**
 * Points ledger controller — read-only history of Glow Points earned/redeemed
 * by the authenticated user. Entries are written wherever glowPoints is
 * changed (see booking.controller.js) — this just lists them.
 */
const asyncHandler = require('../utils/asyncHandler');
const sendResponse = require('../utils/ApiResponse');
const { getPagination, buildMeta } = require('../utils/pagination');
const PointsLedger = require('../models/PointsLedger');

// GET /api/v1/points-ledger/mine
exports.listMine = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const [entries, total] = await Promise.all([
    PointsLedger.find({ user: req.user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    PointsLedger.countDocuments({ user: req.user._id }),
  ]);
  sendResponse(res, 200, 'Points activity', { entries }, buildMeta(page, limit, total));
});
