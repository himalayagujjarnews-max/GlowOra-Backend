/**
 * Consent form controller — customer submits a digital consent/health form
 * for a booking whose service requires one (Service.requiresConsent); the
 * salon (owner/staff/admin) or the customer themselves can then view it.
 * Mirrors the assertOwnsSalon pattern used in customerNote.controller.js.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const ConsentForm = require('../models/ConsentForm');
const Booking = require('../models/Booking');
const Service = require('../models/Service');
const Salon = require('../models/Salon');
const Staff = require('../models/Staff');

// Owner of the salon, an admin, or a staff member belonging to that salon may
// view a consent form for one of its bookings.
async function assertOwnsSalon(user, salonId) {
  const salon = await Salon.findById(salonId);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (user.role === 'admin') return salon;
  if (salon.owner.toString() === user._id.toString()) return salon;
  if (user.role === 'staff') {
    const staffDoc = await Staff.findOne({ salon: salonId, user: user._id }).select('_id');
    if (staffDoc) return salon;
  }
  throw ApiError.forbidden('Not your salon');
}

// POST /api/v1/consent-forms  { booking, allergies?, medicalConditions?, hasReadTerms }
// The customer submits this for their own booking, right after creating it.
exports.create = asyncHandler(async (req, res) => {
  const { booking: bookingId, allergies, medicalConditions, hasReadTerms } = req.body;
  if (!bookingId) throw ApiError.badRequest('booking is required');
  if (!hasReadTerms) throw ApiError.badRequest('You must confirm you have read the treatment terms');

  const booking = await Booking.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.customer.toString() !== req.user._id.toString()) {
    throw ApiError.forbidden('This is not your booking');
  }

  // A consent form only makes sense if at least one booked service actually
  // requires one — guards against a stray/forged submission.
  const serviceIds = (booking.services || []).map((s) => s.service).filter(Boolean);
  const flaggedService = await Service.findOne({ _id: { $in: serviceIds }, requiresConsent: true });
  if (!flaggedService) throw ApiError.badRequest('None of the booked services require a consent form');

  // one form per booking — re-submitting updates the existing one instead of erroring
  const form = await ConsentForm.findOneAndUpdate(
    { booking: booking._id },
    {
      booking: booking._id,
      customer: req.user._id,
      salon: booking.salon,
      service: flaggedService._id,
      allergies,
      medicalConditions,
      hasReadTerms: true,
      signedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  sendResponse(res, 201, 'Consent form submitted', { form });
});

// GET /api/v1/consent-forms/:bookingId
exports.getForBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');

  const isCustomer = booking.customer.toString() === req.user._id.toString();
  if (!isCustomer) await assertOwnsSalon(req.user, booking.salon);

  const form = await ConsentForm.findOne({ booking: booking._id });
  if (!form) throw ApiError.notFound('No consent form for this booking');
  sendResponse(res, 200, 'Consent form', { form });
});
