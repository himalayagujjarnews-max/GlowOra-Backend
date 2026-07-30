/**
 * Call controller — issues Agora RTC tokens so customer & staff can talk
 * in-app without exposing phone numbers. Only valid during the booking window.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const { buildRtcToken } = require('../config/agora');
const Booking = require('../models/Booking');
const Salon = require('../models/Salon');
const Staff = require('../models/Staff');

// POST /calls/token   { bookingId }
exports.getToken = asyncHandler(async (req, res) => {
  const { bookingId } = req.body;
  const booking = await Booking.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');

  const salon = await Salon.findById(booking.salon);
  const isCustomer = booking.customer.toString() === req.user._id.toString();
  const isOwner = salon && salon.owner.toString() === req.user._id.toString();
  // Only the stylist actually assigned to THIS booking may join the call —
  // not just any 'staff' account (previously any staff/admin could fetch a
  // token for someone else's booking).
  const isAssignedStaff =
    booking.staff && (await Staff.exists({ _id: booking.staff, user: req.user._id }));
  const isAdmin = req.user.role === 'admin';
  if (!isCustomer && !isOwner && !isAssignedStaff && !isAdmin) {
    throw ApiError.forbidden('Not allowed');
  }
  if (!booking.communicationUnlocked) {
    throw ApiError.forbidden('Calls are available only after confirmation and before completion.');
  }

  // deterministic channel name per booking; numeric uid per user
  const channel = `booking_${booking._id}`;
  const uid = parseInt(req.user._id.toString().slice(-6), 16) % 1000000;
  const token = buildRtcToken(channel, uid, 'publisher', 3600);

  sendResponse(res, 200, 'Call token issued', token);
});
