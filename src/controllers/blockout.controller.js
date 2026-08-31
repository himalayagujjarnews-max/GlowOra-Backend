/**
 * StaffBlockout controller — salon owners block specific date/time windows
 * for their staff (lunch breaks, personal appointments, holidays, etc.).
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const StaffBlockout = require('../models/StaffBlockout');
const Salon = require('../models/Salon');
const Staff = require('../models/Staff');

async function assertOwner(user, salonId) {
  const salon = await Salon.findById(salonId);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== user._id.toString() && user.role !== 'admin') {
    throw ApiError.forbidden('Only the salon owner can manage blockouts');
  }
  return salon;
}

// GET /api/v1/blockouts?salon=&staff=&from=&to=
// Returns blockouts for a salon's staff within an optional date range.
exports.list = asyncHandler(async (req, res) => {
  const { salon, staff, from, to } = req.query;
  if (!salon) throw ApiError.badRequest('salon is required');

  await assertOwner(req.user, salon);

  const filter = { salon };
  if (staff) filter.staff = staff;
  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = from;
    if (to) filter.date.$lte = to;
  }

  const blockouts = await StaffBlockout.find(filter)
    .populate('staff', 'name avatar')
    .sort({ date: 1, startTime: 1 });

  sendResponse(res, 200, 'Blockouts', { blockouts });
});

// POST /api/v1/blockouts
exports.create = asyncHandler(async (req, res) => {
  const { salon, staff, date, startTime, endTime, reason } = req.body;
  if (!salon || !staff || !date) {
    throw ApiError.badRequest('salon, staff and date are required');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw ApiError.badRequest('date must be in YYYY-MM-DD format');
  }
  if (startTime && endTime && startTime >= endTime) {
    throw ApiError.badRequest('startTime must be before endTime');
  }

  await assertOwner(req.user, salon);

  // Confirm the staff belongs to this salon
  const staffDoc = await Staff.findOne({ _id: staff, salon });
  if (!staffDoc) throw ApiError.notFound('Staff not found in this salon');

  const blockout = await StaffBlockout.create({
    salon, staff, date,
    startTime: startTime || null,
    endTime: endTime || null,
    reason: reason || '',
  });

  sendResponse(res, 201, 'Blockout created', { blockout });
});

// DELETE /api/v1/blockouts/:id
exports.remove = asyncHandler(async (req, res) => {
  const blockout = await StaffBlockout.findById(req.params.id);
  if (!blockout) throw ApiError.notFound('Blockout not found');
  await assertOwner(req.user, blockout.salon);
  await blockout.deleteOne();
  sendResponse(res, 200, 'Blockout removed');
});
