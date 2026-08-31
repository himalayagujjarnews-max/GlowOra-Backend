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
const Booking = require('../models/Booking');
const { notifyUser } = require('../services/notification.service');
const { timeToMinutes, isValidYmd } = require('../utils/helpers');

async function assertOwner(user, salonId) {
  const salon = await Salon.findById(salonId);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== user._id.toString() && user.role !== 'admin') {
    throw ApiError.forbidden('Only the salon owner can manage blockouts');
  }
  return salon;
}

// Active (not yet completed/cancelled) bookings for a staff member that
// overlap a proposed blockout window — used to stop a blockout from being
// created/approved out from under a customer who already has a confirmed
// appointment in that slot. Without this, the customer app kept showing a
// confirmed booking with a stylist who was actually now on approved leave,
// with no cancellation, refund, or notification ever firing.
async function findConflictingBookings(staffId, date, startTime, endTime) {
  const bookings = await Booking.find({
    staff: staffId, date, status: { $in: ['pending', 'confirmed', 'in_progress'] },
  }).select('startTime services bookingCode');
  if (!startTime) return bookings; // all-day block — every active booking that day conflicts
  const blockStart = timeToMinutes(startTime);
  const blockEnd = timeToMinutes(endTime);
  return bookings.filter((b) => {
    const bStart = timeToMinutes(b.startTime);
    const bDuration = (b.services || []).reduce((s, x) => s + (x.durationMinutes || 0), 0) || 30;
    const bEnd = bStart + bDuration;
    return bStart < blockEnd && bEnd > blockStart; // range overlap
  });
}

// GET /api/v1/blockouts?salon=&staff=&from=&to=&status=
// Returns blockouts for a salon's staff within an optional date range.
// `status` is optional and deliberately UNBOUNDED by date when passed
// alone — the Roster screen uses `status=pending` with no from/to so a
// staff leave REQUEST made far in the future doesn't stay invisible to the
// owner until it happens to roll inside the regular 30-day blocked-dates
// window (it was invisible either way before approval, since pending
// blockouts don't affect availability).
exports.list = asyncHandler(async (req, res) => {
  const { salon, staff, from, to, status } = req.query;
  if (!salon) throw ApiError.badRequest('salon is required');

  await assertOwner(req.user, salon);

  const filter = { salon };
  if (staff) filter.staff = staff;
  if (status) filter.status = status;
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
  if (!isValidYmd(date)) {
    throw ApiError.badRequest('date must be a valid calendar date in YYYY-MM-DD format');
  }
  if (startTime && endTime && timeToMinutes(startTime) >= timeToMinutes(endTime)) {
    throw ApiError.badRequest('startTime must be before endTime');
  }

  await assertOwner(req.user, salon);

  // Confirm the staff belongs to this salon
  const staffDoc = await Staff.findOne({ _id: staff, salon });
  if (!staffDoc) throw ApiError.notFound('Staff not found in this salon');

  const conflicts = await findConflictingBookings(staff, date, startTime || null, endTime || null);
  if (conflicts.length > 0) {
    throw ApiError.badRequest(
      `${staffDoc.name} has ${conflicts.length} active booking(s) in that window (e.g. ${conflicts[0].bookingCode}). Reschedule or cancel them first.`
    );
  }

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

// ---- Staff self-service leave requests ----
// Staff can request their OWN blockout (a specific date/time off, or a whole
// day) without owner involvement up front — it lands as 'pending' and does
// NOT block booking availability (see booking.controller.js getAvailability)
// until the owner reviews and approves it below.

async function resolveStaffDoc(user) {
  const staffDoc = await Staff.findOne({ user: user._id });
  if (!staffDoc) throw ApiError.forbidden('No staff profile linked to this account');
  return staffDoc;
}

// GET /api/v1/blockouts/mine?from=&to=  (staff)
// The logged-in staff member's own leave requests/blockouts, any status —
// so they can see what's pending, approved, or was declined.
exports.mine = asyncHandler(async (req, res) => {
  const staffDoc = await resolveStaffDoc(req.user);
  const { from, to } = req.query;
  const filter = { staff: staffDoc._id };
  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = from;
    if (to) filter.date.$lte = to;
  }
  const blockouts = await StaffBlockout.find(filter).sort({ date: -1 });
  sendResponse(res, 200, 'Your leave requests', { blockouts });
});

// POST /api/v1/blockouts/request  { date, startTime?, endTime?, reason? }  (staff)
exports.requestLeave = asyncHandler(async (req, res) => {
  const { date, startTime, endTime, reason } = req.body;
  if (!date) throw ApiError.badRequest('date is required');
  if (!isValidYmd(date)) throw ApiError.badRequest('date must be a valid calendar date in YYYY-MM-DD format');
  if (startTime && endTime && timeToMinutes(startTime) >= timeToMinutes(endTime)) throw ApiError.badRequest('startTime must be before endTime');

  const staffDoc = await resolveStaffDoc(req.user);
  const blockout = await StaffBlockout.create({
    salon: staffDoc.salon, staff: staffDoc._id, date,
    startTime: startTime || null, endTime: endTime || null,
    reason: reason || '', status: 'pending',
  });

  const salon = await Salon.findById(staffDoc.salon).select('owner name');
  if (salon) {
    notifyUser(salon.owner, {
      title: 'New leave request',
      body: `${staffDoc.name} requested time off on ${date}${startTime ? ` (${startTime}–${endTime})` : ' (whole day)'}.`,
      type: 'system',
      data: { blockoutId: blockout._id.toString() },
    });
  }

  sendResponse(res, 201, 'Leave request submitted', { blockout });
});

// PATCH /api/v1/blockouts/:id/respond  { approve: true|false }  (owner/admin)
exports.respond = asyncHandler(async (req, res) => {
  const { approve } = req.body;
  if (typeof approve !== 'boolean') throw ApiError.badRequest('approve (true/false) is required');

  const blockout = await StaffBlockout.findById(req.params.id);
  if (!blockout) throw ApiError.notFound('Blockout not found');
  await assertOwner(req.user, blockout.salon);

  if (blockout.status !== 'pending') {
    throw ApiError.badRequest('This request has already been responded to');
  }

  const staffDoc = await Staff.findById(blockout.staff).select('user name');

  // Approving means this window will start blocking new bookings — but any
  // customer who ALREADY has an active booking with this staff member in
  // that window would be left stranded with a confirmed appointment and a
  // now-unavailable stylist, with no cancellation/refund/notification ever
  // firing. Block the approval until the owner deals with those bookings
  // through the normal cancel/reschedule flow (which does notify the
  // customer), rather than silently orphaning them.
  if (approve) {
    const conflicts = await findConflictingBookings(blockout.staff, blockout.date, blockout.startTime, blockout.endTime);
    if (conflicts.length > 0) {
      throw ApiError.badRequest(
        `Can't approve — ${staffDoc?.name || 'this staff member'} has ${conflicts.length} active booking(s) overlapping this time (e.g. ${conflicts[0].bookingCode}). Reschedule or cancel them first, then approve.`
      );
    }
  }

  // Atomic compare-and-swap on status — if two respond() calls race (a
  // double-tap, or the owner and an admin acting at the same time), only
  // one of them can flip status away from 'pending'; the loser gets null
  // back and reports the same "already responded to" error instead of
  // silently overwriting the first decision with a second, contradictory one.
  const updated = await StaffBlockout.findOneAndUpdate(
    { _id: blockout._id, status: 'pending' },
    { status: approve ? 'approved' : 'rejected' },
    { new: true }
  );
  if (!updated) {
    throw ApiError.badRequest('This request has already been responded to');
  }

  if (staffDoc?.user) {
    notifyUser(staffDoc.user, {
      title: approve ? 'Leave approved ✅' : 'Leave request declined',
      body: approve
        ? `Your time off on ${updated.date} has been approved.`
        : `Your leave request for ${updated.date} was declined by your salon.`,
      type: 'system',
      data: { blockoutId: updated._id.toString() },
    });
  }

  sendResponse(res, 200, approve ? 'Leave approved' : 'Leave rejected', { blockout: updated });
});

// DELETE /api/v1/blockouts/:id/withdraw  (staff)
// Lets a staff member pull back their OWN leave request while it's still
// 'pending' — previously the only delete path (ctrl.remove) was owner/admin
// only, so a request submitted by mistake (wrong date, changed plans) sat
// stuck awaiting a decision the staff member could no longer influence,
// forcing them to ask the owner to manually decline it instead. Scoped to
// 'pending' only — once approved/rejected it's a decided record; if
// circumstances change after approval, that should go through the owner.
exports.withdraw = asyncHandler(async (req, res) => {
  const staffDoc = await resolveStaffDoc(req.user);
  const blockout = await StaffBlockout.findById(req.params.id);
  if (!blockout) throw ApiError.notFound('Leave request not found');
  if (blockout.staff.toString() !== staffDoc._id.toString()) {
    throw ApiError.forbidden('Not your leave request');
  }
  // Atomic guard mirrors respond() above — if the owner approves/rejects at
  // the same moment the staff member withdraws, only one of the two writes
  // should win instead of silently deleting a request the owner just acted on.
  const deleted = await StaffBlockout.findOneAndDelete({ _id: blockout._id, status: 'pending' });
  if (!deleted) {
    throw ApiError.badRequest('This request has already been responded to and can no longer be withdrawn');
  }
  sendResponse(res, 200, 'Leave request withdrawn');
});
