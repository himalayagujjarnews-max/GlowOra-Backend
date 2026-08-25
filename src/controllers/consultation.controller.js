/**
 * Consultation controller — lets a customer request a quick video/voice
 * consultation with a salon's stylist BEFORE booking anything, and lets the
 * owner/staff accept or decline it. On accept, both sides can fetch a call
 * token for the room `consultation_<id>` via `respond`'s response / the
 * `mine` list — same Agora token builder call.controller.js uses for
 * booking-based calls (see `buildRtcToken` in ../config/agora), just keyed
 * by a consultation id instead of a booking id.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const { buildRtcToken } = require('../config/agora');
const Consultation = require('../models/Consultation');
const Salon = require('../models/Salon');
const Staff = require('../models/Staff');
const { notifyUser } = require('../services/notification.service');

// POST /consultations   { salon, staff, scheduledAt? }   (customer)
exports.request = asyncHandler(async (req, res) => {
  const { salon, staff, scheduledAt } = req.body;
  if (!salon || !staff) throw ApiError.badRequest('salon and staff are required');

  const staffDoc = await Staff.findById(staff);
  if (!staffDoc || staffDoc.salon.toString() !== salon.toString()) {
    throw ApiError.notFound('Stylist not found at this salon');
  }
  const salonDoc = await Salon.findById(salon);
  if (!salonDoc) throw ApiError.notFound('Salon not found');

  const consultation = await Consultation.create({
    customer: req.user._id,
    salon,
    staff,
    scheduledAt: scheduledAt || null,
  });

  // notify the stylist (if they have a login) and the owner
  try {
    if (staffDoc.user) {
      notifyUser(staffDoc.user, {
        title: 'New consultation request',
        body: `${req.user.name || 'A customer'} wants a quick consultation with you.`,
        type: 'consultation', data: { consultationId: consultation._id.toString() },
      });
    }
    notifyUser(salonDoc.owner, {
      title: 'New consultation request',
      body: `${req.user.name || 'A customer'} wants a consultation with ${staffDoc.name}.`,
      type: 'consultation', data: { consultationId: consultation._id.toString() },
    });
  } catch { /* non-fatal */ }

  sendResponse(res, 201, 'Consultation requested', { consultation });
});

// PATCH /consultations/:id/respond   { accept: true/false }   (owner/staff)
exports.respond = asyncHandler(async (req, res) => {
  const consultation = await Consultation.findById(req.params.id);
  if (!consultation) throw ApiError.notFound('Consultation not found');
  if (consultation.status !== 'requested') {
    throw ApiError.badRequest('This request has already been responded to.');
  }

  const salon = await Salon.findById(consultation.salon);
  const isOwner = salon && salon.owner.toString() === req.user._id.toString();
  const isAssignedStaff = await Staff.exists({ _id: consultation.staff, user: req.user._id });
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isAssignedStaff && !isAdmin) throw ApiError.forbidden('Not allowed');

  const accept = !!req.body.accept;
  consultation.status = accept ? 'accepted' : 'declined';
  await consultation.save();

  // notify the customer either way
  try {
    notifyUser(consultation.customer, {
      title: accept ? 'Consultation accepted!' : 'Consultation declined',
      body: accept
        ? 'Your stylist accepted — join the call now.'
        : 'The stylist could not take your consultation request right now.',
      type: 'consultation', data: { consultationId: consultation._id.toString() },
    });
  } catch { /* non-fatal */ }

  let call = null;
  if (accept) {
    // Same deterministic channel/uid scheme as call.controller.js's getToken,
    // just rooming by consultation id instead of booking id.
    const channel = `consultation_${consultation._id}`;
    const uid = parseInt(req.user._id.toString().slice(-6), 16) % 1000000;
    call = buildRtcToken(channel, uid, 'publisher', 3600);
  }

  sendResponse(res, 200, accept ? 'Consultation accepted' : 'Consultation declined', { consultation, call });
});

// GET /consultations/mine   (customer or staff/owner)
exports.mine = asyncHandler(async (req, res) => {
  let filter;
  if (req.user.role === 'owner' || req.user.role === 'admin') {
    const salons = await Salon.find({ owner: req.user._id }).select('_id');
    filter = { salon: { $in: salons.map((s) => s._id) } };
  } else if (req.user.role === 'staff') {
    const staffDocs = await Staff.find({ user: req.user._id }).select('_id');
    filter = { staff: { $in: staffDocs.map((s) => s._id) } };
  } else {
    filter = { customer: req.user._id };
  }

  const consultations = await Consultation.find(filter)
    .sort({ createdAt: -1 })
    .populate('customer', 'name avatar')
    .populate('staff', 'name avatar')
    .populate('salon', 'name');

  sendResponse(res, 200, 'Consultations', { consultations });
});

// GET /consultations/:id/token   — fetch an Agora token for an already-accepted consultation
exports.getToken = asyncHandler(async (req, res) => {
  const consultation = await Consultation.findById(req.params.id);
  if (!consultation) throw ApiError.notFound('Consultation not found');
  if (consultation.status !== 'accepted') throw ApiError.forbidden('This consultation is not active.');

  const salon = await Salon.findById(consultation.salon);
  const isCustomer = consultation.customer.toString() === req.user._id.toString();
  const isOwner = salon && salon.owner.toString() === req.user._id.toString();
  const isAssignedStaff = await Staff.exists({ _id: consultation.staff, user: req.user._id });
  const isAdmin = req.user.role === 'admin';
  if (!isCustomer && !isOwner && !isAssignedStaff && !isAdmin) throw ApiError.forbidden('Not allowed');

  const channel = `consultation_${consultation._id}`;
  const uid = parseInt(req.user._id.toString().slice(-6), 16) % 1000000;
  const token = buildRtcToken(channel, uid, 'publisher', 3600);

  sendResponse(res, 200, 'Call token issued', token);
});
