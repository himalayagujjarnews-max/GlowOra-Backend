/**
 * Customer note controller — lets a salon's owner/staff keep private CRM
 * notes about a customer (allergies, preferences, no-show history, etc.).
 * Mirrors the assertOwns pattern used in service.controller.js / package.controller.js.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const CustomerNote = require('../models/CustomerNote');
const Salon = require('../models/Salon');
const Staff = require('../models/Staff');

// Owner of the salon, an admin, or a staff member belonging to that salon may
// read/write its customer notes.
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

// GET /api/v1/customer-notes?salon=&customer=
exports.list = asyncHandler(async (req, res) => {
  const { salon, customer } = req.query;
  if (!salon || !customer) throw ApiError.badRequest('salon and customer query params required');
  await assertOwnsSalon(req.user, salon);
  const notes = await CustomerNote.find({ salon, customer })
    .populate('createdBy', 'name')
    .sort({ createdAt: -1 });
  sendResponse(res, 200, 'Customer notes', { count: notes.length, notes });
});

// POST /api/v1/customer-notes  { salon, customer, note }
exports.create = asyncHandler(async (req, res) => {
  const { salon, customer, note } = req.body;
  if (!salon || !customer || !note) throw ApiError.badRequest('salon, customer and note are required');
  await assertOwnsSalon(req.user, salon);
  const created = await CustomerNote.create({ salon, customer, note, createdBy: req.user._id });
  sendResponse(res, 201, 'Note added', { note: created });
});
