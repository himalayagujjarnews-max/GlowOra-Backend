/**
 * Favorite controller — customers save/unsave salons.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const Favorite = require('../models/Favorite');

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
