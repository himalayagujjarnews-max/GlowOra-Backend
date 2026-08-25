/**
 * Referral controller — leaderboard of top referrers.
 *
 * Referral tracking already exists (User.referralCode / User.referredBy,
 * wired up in auth.controller.js's verifyOtp/firebaseLogin), but there's no
 * denormalized referral count on User — so the count here is computed live
 * via aggregation rather than sorting a pre-existing field.
 */
const asyncHandler = require('../utils/asyncHandler');
const sendResponse = require('../utils/ApiResponse');
const User = require('../models/User');

// Privacy-friendly display name: "First L." instead of the full name.
function partialName(name) {
  if (!name) return 'GlowOra user';
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
}

// GET /referral/leaderboard   (any logged-in user)
// Top 20 referrers by number of users they've brought in, plus the current
// user's own count/rank even when they're outside the top 20.
exports.leaderboard = asyncHandler(async (req, res) => {
  // count referrals per referrer across the whole user base, highest first
  const counts = await User.aggregate([
    { $match: { referredBy: { $ne: null } } },
    { $group: { _id: '$referredBy', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  const topEntries = counts.slice(0, 20);
  const topUsers = await User.find({ _id: { $in: topEntries.map((c) => c._id) } }).select('name');
  const nameById = new Map(topUsers.map((u) => [u._id.toString(), u.name]));

  const top = topEntries.map((c, i) => ({
    rank: i + 1,
    name: partialName(nameById.get(c._id.toString())),
    count: c.count,
  }));

  // current user's position among ALL referrers (not just the top 20)
  const myIndex = counts.findIndex((c) => c._id.toString() === req.user._id.toString());
  const myRank = {
    rank: myIndex >= 0 ? myIndex + 1 : null, // null = hasn't referred anyone yet
    name: partialName(req.user.name),
    count: myIndex >= 0 ? counts[myIndex].count : 0,
  };

  sendResponse(res, 200, 'Referral leaderboard', { top, myRank });
});
