/**
 * Abandoned-cart controller — records when a customer reaches the booking
 * screen with services selected but hasn't booked yet, so a scheduled job
 * (scheduler.service.js) can nudge them later if they never complete it.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const AbandonedCart = require('../models/AbandonedCart');

// POST /bookings/abandoned-cart   { salon, services: [ids], staff? }   (customer)
// Frontend fires this once per screen visit (debounced on mount, not on every
// selection change). Upserts by {user, salon} so repeat visits just refresh
// the timestamp/services rather than creating duplicates, and resets
// `reminded: false` on every call so a later re-visit after an earlier
// reminder still gets its own follow-up instead of being silently skipped.
exports.track = asyncHandler(async (req, res) => {
  const { salon, services, staff } = req.body;
  if (!salon || !services?.length) throw ApiError.badRequest('salon and services are required');

  await AbandonedCart.findOneAndUpdate(
    { user: req.user._id, salon },
    { services, staff: staff || undefined, reminded: false },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  sendResponse(res, 200, 'Cart tracked');
});
