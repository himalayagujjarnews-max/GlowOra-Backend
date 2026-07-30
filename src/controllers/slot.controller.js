/**
 * Slot controller — salon owners generate slots, block times, mark holidays.
 * (Customer availability lives in booking.controller.getAvailability.)
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const Slot = require('../models/Slot');
const Salon = require('../models/Salon');
const { addMinutes } = require('../utils/helpers');

async function assertOwns(user, salonId) {
  const salon = await Salon.findById(salonId);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== user._id.toString() && user.role !== 'admin') {
    throw ApiError.forbidden('Not your salon');
  }
  return salon;
}

// POST /slots/generate  { salon, staff, date, step? } — auto-create slots for a day
exports.generate = asyncHandler(async (req, res) => {
  const { salon, staff, date, step = 30 } = req.body;
  if (!salon || !staff || !date) throw ApiError.badRequest('salon, staff and date are required');
  const salonDoc = await assertOwns(req.user, salon);

  const open = salonDoc.openTime || '09:00';
  const close = salonDoc.closeTime || '20:00';
  let cur = open;
  const created = [];
  while (cur < close) {
    const end = addMinutes(cur, step);
    if (end > close) break;
    // skip break window
    if (salonDoc.breakStart && salonDoc.breakEnd && cur >= salonDoc.breakStart && cur < salonDoc.breakEnd) {
      cur = end; continue;
    }
    try {
      const slot = await Slot.create({ salon, staff, date, startTime: cur, endTime: end, status: 'available' });
      created.push(slot);
    } catch (err) {
      if (err.code !== 11000) throw err; // ignore duplicates
    }
    cur = end;
  }
  sendResponse(res, 201, `${created.length} slots generated`, { count: created.length });
});

// POST /slots/holiday  { salon, staff, date } — block a whole day
exports.markHoliday = asyncHandler(async (req, res) => {
  const { salon, staff, date } = req.body;
  if (!salon || !date) throw ApiError.badRequest('salon and date are required');
  await assertOwns(req.user, salon);
  const filter = { salon, date, status: { $ne: 'booked' } };
  if (staff) filter.staff = staff;
  await Slot.updateMany(filter, { status: 'blocked' });
  sendResponse(res, 200, 'Holiday marked — day blocked');
});

// POST /slots/block  { slotId }  — block a single slot
exports.blockSlot = asyncHandler(async (req, res) => {
  const slot = await Slot.findById(req.body.slotId);
  if (!slot) throw ApiError.notFound('Slot not found');
  await assertOwns(req.user, slot.salon);
  if (slot.status === 'booked') throw ApiError.badRequest('Cannot block a booked slot');
  slot.status = slot.status === 'blocked' ? 'available' : 'blocked';
  await slot.save();
  sendResponse(res, 200, slot.status === 'blocked' ? 'Slot blocked' : 'Slot reopened', { slot });
});

// GET /slots?salon=&staff=&date=  (owner view — all slots incl. blocked)
exports.list = asyncHandler(async (req, res) => {
  const { salon, staff, date } = req.query;
  if (!salon || !date) throw ApiError.badRequest('salon and date are required');
  await assertOwns(req.user, salon);
  const filter = { salon, date };
  if (staff) filter.staff = staff;
  const slots = await Slot.find(filter).sort({ startTime: 1 });
  sendResponse(res, 200, 'Slots', { slots });
});
