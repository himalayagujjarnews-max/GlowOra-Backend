/**
 * Favorite controller — customers save/unsave salons (and, separately,
 * favorite stylists — see the *Staff exports below).
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const Favorite = require('../models/Favorite');
const FavoriteStaff = require('../models/FavoriteStaff');

// GET /favorites
exports.list = asyncHandler(async (req, res) => {
  const favorites = await Favorite.find({ user: req.user._id })
    .populate('salon', 'name coverImage address rating reviewCount type');
  sendResponse(res, 200, 'Favorites', { favorites });
});

// POST /favorites   { salon }
exports.add = asyncHandler(async (req, res) => {
  const { salon } = req.body;
  if (!salon) throw ApiError.badRequest('salon is required');
  try {
    const fav = await Favorite.create({ user: req.user._id, salon });
    sendResponse(res, 201, 'Added to favorites', { favorite: fav });
  } catch (err) {
    if (err.code === 11000) return sendResponse(res, 200, 'Already in favorites');
    throw err;
  }
});

// DELETE /favorites/:salonId
exports.remove = asyncHandler(async (req, res) => {
  await Favorite.findOneAndDelete({ user: req.user._id, salon: req.params.salonId });
  sendResponse(res, 200, 'Removed from favorites');
});

// ─── Favorite stylists (mirrors the salon favorites above) ───

// GET /favorites/staff
exports.listStaff = asyncHandler(async (req, res) => {
  const favorites = await FavoriteStaff.find({ user: req.user._id })
    .populate({
      path: 'staff',
      select: 'name avatar specialities rating reviewCount salon',
      populate: { path: 'salon', select: 'name coverImage address' },
    });
  sendResponse(res, 200, 'Favorite stylists', { favorites });
});

// POST /favorites/staff   { staff }
exports.addStaff = asyncHandler(async (req, res) => {
  const { staff } = req.body;
  if (!staff) throw ApiError.badRequest('staff is required');
  try {
    const fav = await FavoriteStaff.create({ user: req.user._id, staff });
    sendResponse(res, 201, 'Added to favorite stylists', { favorite: fav });
  } catch (err) {
    if (err.code === 11000) return sendResponse(res, 200, 'Already in favorite stylists');
    throw err;
  }
});

// DELETE /favorites/staff/:staffId
exports.removeStaff = asyncHandler(async (req, res) => {
  await FavoriteStaff.findOneAndDelete({ user: req.user._id, staff: req.params.staffId });
  sendResponse(res, 200, 'Removed from favorite stylists');
});
