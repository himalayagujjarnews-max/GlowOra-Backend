/**
 * Review controller — customers rate completed bookings; salons can reply.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const Review = require('../models/Review');
const Booking = require('../models/Booking');
const Salon = require('../models/Salon');

// GET /api/v1/reviews?salon=
exports.listForSalon = asyncHandler(async (req, res) => {
  if (!req.query.salon) throw ApiError.badRequest('salon query param required');
  const reviews = await Review.find({ salon: req.query.salon })
    .populate('customer', 'name avatar')
    .sort({ createdAt: -1 });
  sendResponse(res, 200, 'Reviews', { count: reviews.length, reviews });
});

// POST /api/v1/reviews  { bookingId, rating, staffRating?, comment }  (customer)
// `rating` rates the salon; `staffRating` separately rates the assigned
// stylist (only relevant if the booking had one — otherwise omit it).
exports.create = asyncHandler(async (req, res) => {
  const { bookingId, rating, staffRating, comment } = req.body;
  if (!bookingId || !rating) throw ApiError.badRequest('bookingId and rating are required');

  const booking = await Booking.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.customer.toString() !== req.user._id.toString()) throw ApiError.forbidden('Not your booking');
  if (booking.status !== 'completed') throw ApiError.badRequest('You can only review completed bookings');
  if (booking.ratedByCustomer) throw ApiError.conflict('You have already reviewed this booking');

  const review = await Review.create({
    booking: booking._id,
    customer: req.user._id,
    salon: booking.salon,
    staff: booking.staff,
    rating,
    staffRating: booking.staff && staffRating ? staffRating : undefined,
    comment,
  });

  booking.ratedByCustomer = true;
  await booking.save();

  sendResponse(res, 201, 'Thanks for your review', { review });
});

// PATCH /api/v1/reviews/:id/reply  { reply }  (owner)
exports.reply = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) throw ApiError.notFound('Review not found');
  const salon = await Salon.findById(review.salon);
  if (salon.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw ApiError.forbidden('Not your salon');
  }
  review.reply = req.body.reply;
  await review.save();
  sendResponse(res, 200, 'Reply added', { review });
});
