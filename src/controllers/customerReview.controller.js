/**
 * Customer review controller — the salon owner or the staff member assigned
 * to a booking can rate the CUSTOMER (reliability/behaviour) with a comment,
 * once the booking is completed. Mirrors review.controller.js but reversed.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const CustomerReview = require('../models/CustomerReview');
const Booking = require('../models/Booking');
const Staff = require('../models/Staff');
const Salon = require('../models/Salon');

// POST /api/v1/customer-reviews  { bookingId, rating, comment }  (owner/staff)
exports.create = asyncHandler(async (req, res) => {
  const { bookingId, rating, comment } = req.body;
  if (!bookingId || !rating) throw ApiError.badRequest('bookingId and rating are required');

  const booking = await Booking.findById(bookingId).populate('salon', 'owner');
  if (!booking) throw ApiError.notFound('Booking not found');

  const isOwner = booking.salon.owner.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'admin';
  let isAssignedStaff = false;
  if (!isOwner && !isAdmin && req.user.role === 'staff') {
    const staffDoc = await Staff.findOne({ _id: booking.staff, user: req.user._id }).select('_id');
    isAssignedStaff = Boolean(staffDoc);
  }
  if (!isOwner && !isAdmin && !isAssignedStaff) throw ApiError.forbidden('Not your booking');

  if (booking.status !== 'completed') throw ApiError.badRequest('You can only rate customers on completed bookings');
  if (booking.ratedBySalon) throw ApiError.conflict('You have already rated this customer for this booking');

  const review = await CustomerReview.create({
    booking: booking._id,
    salon: booking.salon._id,
    customer: booking.customer,
    ratedBy: req.user._id,
    rating, comment,
  });

  booking.ratedBySalon = true;
  await booking.save();

  sendResponse(res, 201, 'Customer rated', { review });
});

// GET /api/v1/customer-reviews?customer=  (owner/staff/admin — vet a customer's
// history, INCLUDING other salons' ratings, before accepting their booking —
// that cross-salon visibility is intentional, like a shared reliability score.
// What was NOT intentional: this had zero relationship check, so any owner/
// staff account could pass an arbitrary customer id (even one that's never
// booked with them) and read every private behavior note any salon ever wrote
// about that person — a platform-wide enumeration/data-leak vector. Now
// requires the requester to actually have a booking (any status) from that
// customer at one of their own salons — i.e. you can only vet people who've
// actually tried to book with YOU, not browse the whole customer base.
exports.listForCustomer = asyncHandler(async (req, res) => {
  if (!req.query.customer) throw ApiError.badRequest('customer query param required');

  if (req.user.role !== 'admin') {
    let mySalonIds = [];
    if (req.user.role === 'owner') {
      mySalonIds = (await Salon.find({ owner: req.user._id }).select('_id')).map((s) => s._id);
    } else if (req.user.role === 'staff') {
      mySalonIds = (await Staff.find({ user: req.user._id }).select('salon')).map((s) => s.salon);
    }
    const hasRelationship = mySalonIds.length > 0 && await Booking.exists({
      customer: req.query.customer,
      salon: { $in: mySalonIds },
    });
    if (!hasRelationship) throw ApiError.forbidden('This customer has no booking history with your salon');
  }

  const reviews = await CustomerReview.find({ customer: req.query.customer })
    .populate('ratedBy', 'name')
    .populate('salon', 'name')
    .sort({ createdAt: -1 });
  sendResponse(res, 200, 'Customer reviews', { count: reviews.length, reviews });
});
