/**
 * Shift controller — the owner's weekly staff roster.
 * A "shift" is really "staff X's schedule for day Y", so upsert() lets the
 * owner just resubmit the same salon+staff+dayOfWeek to edit it, instead of
 * needing separate update/delete calls for the common case.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const Shift = require('../models/Shift');
const Staff = require('../models/Staff');
const Salon = require('../models/Salon');

async function assertAllowed(user, salonId) {
  const salon = await Salon.findById(salonId);
  if (!salon) throw ApiError.notFound('Salon not found');
  const isOwner = salon.owner.toString() === user._id.toString();
  const isAdmin = user.role === 'admin';
  let isSalonStaff = false;
  if (!isOwner && !isAdmin && user.role === 'staff') {
    const staffDoc = await Staff.findOne({ salon: salonId, user: user._id }).select('_id');
    isSalonStaff = Boolean(staffDoc);
  }
  if (!isOwner && !isAdmin && !isSalonStaff) throw ApiError.forbidden('Not allowed');
  return { salon, isOwner, isAdmin };
}

// GET /api/v1/shifts?salon=  (owner/staff/admin of that salon)
// Returns every shift for the salon so the owner can render a full weekly grid.
exports.listForSalon = asyncHandler(async (req, res) => {
  const { salon } = req.query;
  if (!salon) throw ApiError.badRequest('salon query param required');
  await assertAllowed(req.user, salon);
  const shifts = await Shift.find({ salon }).populate('staff', 'name avatar');
  sendResponse(res, 200, 'Shifts', { count: shifts.length, shifts });
});

// POST /api/v1/shifts  { salon, staff, dayOfWeek, startTime, endTime, isOff }  (owner/admin)
// Upsert on {salon, staff, dayOfWeek} — resubmitting the same day/staff edits it.
exports.upsert = asyncHandler(async (req, res) => {
  const { salon, staff, dayOfWeek, startTime, endTime, isOff } = req.body;
  if (!salon || !staff || dayOfWeek === undefined || dayOfWeek === null) {
    throw ApiError.badRequest('salon, staff and dayOfWeek are required');
  }
  if (dayOfWeek < 0 || dayOfWeek > 6) throw ApiError.badRequest('dayOfWeek must be 0-6 (0=Sun)');
  await assertAllowed(req.user, salon);

  const staffDoc = await Staff.findById(staff);
  if (!staffDoc || staffDoc.salon.toString() !== salon) throw ApiError.badRequest('Invalid staff for this salon');

  const shift = await Shift.findOneAndUpdate(
    { salon, staff, dayOfWeek },
    { $set: { startTime, endTime, isOff: Boolean(isOff) } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  sendResponse(res, 200, 'Shift saved', { shift });
});

// DELETE /api/v1/shifts/:id  (owner/admin) — clears a day entirely
exports.remove = asyncHandler(async (req, res) => {
  const shift = await Shift.findById(req.params.id);
  if (!shift) throw ApiError.notFound('Shift not found');
  await assertAllowed(req.user, shift.salon);
  await shift.deleteOne();
  sendResponse(res, 200, 'Shift cleared');
});
