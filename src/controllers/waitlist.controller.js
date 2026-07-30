/**
 * Waitlist controller — join/leave a waitlist for a busy day, and (internal)
 * notify the next waiters when a slot frees up.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const Waitlist = require('../models/Waitlist');
const Salon = require('../models/Salon');
const { notifyUser } = require('../services/notification.service');

// POST /waitlist   { salon, date, staff?, serviceIds?, preferredTime? }
exports.join = asyncHandler(async (req, res) => {
  const { salon, date } = req.body;
  if (!salon || !date) throw ApiError.badRequest('salon and date are required');
  const salonDoc = await Salon.findById(salon);
  if (!salonDoc || salonDoc.status !== 'active') throw ApiError.notFound('Salon not available');

  const existing = await Waitlist.findOne({ customer: req.user._id, salon, date, status: 'waiting' });
  if (existing) return sendResponse(res, 200, 'Already on the waitlist', { entry: existing });

  const entry = await Waitlist.create({
    customer: req.user._id, salon, date,
    staff: req.body.staff, serviceIds: req.body.serviceIds, preferredTime: req.body.preferredTime,
  });
  sendResponse(res, 201, "You're on the waitlist — we'll notify you if a slot opens", { entry });
});

// GET /waitlist/mine
exports.mine = asyncHandler(async (req, res) => {
  const entries = await Waitlist.find({ customer: req.user._id })
    .populate('salon', 'name coverImage').sort({ createdAt: -1 });
  sendResponse(res, 200, 'Your waitlist', { entries });
});

// DELETE /waitlist/:id
exports.leave = asyncHandler(async (req, res) => {
  const entry = await Waitlist.findOneAndUpdate(
    { _id: req.params.id, customer: req.user._id },
    { status: 'cancelled' }, { new: true }
  );
  if (!entry) throw ApiError.notFound('Waitlist entry not found');
  sendResponse(res, 200, 'Removed from waitlist');
});

/**
 * Internal — call when a slot frees (e.g. on cancellation). Notifies up to
 * `limit` earliest waiters for that salon+date.
 */
async function notifyWaiters(salonId, date, limit = 3) {
  const waiters = await Waitlist.find({ salon: salonId, date, status: 'waiting' })
    .sort({ createdAt: 1 }).limit(limit);
  const salon = await Salon.findById(salonId).select('name');
  for (const w of waiters) {
    w.status = 'notified';
    w.notifiedAt = new Date();
    await w.save();
    notifyUser(w.customer, {
      title: 'A slot just opened! 🎉',
      body: `A slot for ${date} at ${salon?.name || 'your salon'} is now available. Book fast!`,
      type: 'booking', data: { salonId: salonId.toString(), date },
    });
  }
  return waiters.length;
}
exports.notifyWaiters = notifyWaiters;
