/**
 * RecurringBooking controller — a customer's standing appointment.
 * Creating one does NOT book immediately; a scheduler creates real bookings
 * on each due date. Customers can pause/cancel anytime.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const RecurringBooking = require('../models/RecurringBooking');
const Salon = require('../models/Salon');
const Staff = require('../models/Staff');
const { localYmd } = require('../utils/helpers');

function addFrequency(ymdStr, frequency) {
  const d = new Date(`${ymdStr}T00:00:00`);
  if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else if (frequency === 'biweekly') d.setDate(d.getDate() + 14);
  else d.setMonth(d.getMonth() + 1); // monthly
  return d.toISOString().slice(0, 10);
}
exports.addFrequency = addFrequency;

// POST /recurring   { salon, staff, serviceIds, frequency, preferredTime, startDate?, paymentMode? }
exports.create = asyncHandler(async (req, res) => {
  const { salon, staff, serviceIds, frequency, preferredTime } = req.body;
  if (!salon || !staff || !serviceIds?.length || !frequency || !preferredTime) {
    throw ApiError.badRequest('salon, staff, serviceIds, frequency and preferredTime are required');
  }
  if (!['weekly', 'biweekly', 'monthly'].includes(frequency)) throw ApiError.badRequest('Invalid frequency');

  const [salonDoc, staffDoc] = await Promise.all([Salon.findById(salon), Staff.findById(staff)]);
  if (!salonDoc || salonDoc.status !== 'active') throw ApiError.notFound('Salon not available');
  if (!staffDoc || staffDoc.salon.toString() !== salon) throw ApiError.badRequest('Invalid staff');

  const nextRunDate = req.body.startDate || addFrequency(localYmd(), frequency);
  const rec = await RecurringBooking.create({
    customer: req.user._id, salon, staff, serviceIds, frequency, preferredTime,
    paymentMode: req.body.paymentMode || 'at_salon', nextRunDate,
  });
  sendResponse(res, 201, 'Recurring appointment set up', { recurring: rec });
});

// GET /recurring/mine
exports.mine = asyncHandler(async (req, res) => {
  const list = await RecurringBooking.find({ customer: req.user._id })
    .populate('salon', 'name').populate('staff', 'name').sort({ createdAt: -1 });
  sendResponse(res, 200, 'Recurring appointments', { recurring: list });
});

// PATCH /recurring/:id   { active, preferredTime, frequency }
exports.update = asyncHandler(async (req, res) => {
  const rec = await RecurringBooking.findOne({ _id: req.params.id, customer: req.user._id });
  if (!rec) throw ApiError.notFound('Not found');
  ['active', 'preferredTime', 'frequency'].forEach((k) => { if (req.body[k] !== undefined) rec[k] = req.body[k]; });
  await rec.save();
  sendResponse(res, 200, 'Recurring appointment updated', { recurring: rec });
});

// DELETE /recurring/:id
exports.remove = asyncHandler(async (req, res) => {
  const rec = await RecurringBooking.findOneAndUpdate(
    { _id: req.params.id, customer: req.user._id }, { active: false }, { new: true }
  );
  if (!rec) throw ApiError.notFound('Not found');
  sendResponse(res, 200, 'Recurring appointment cancelled');
});
