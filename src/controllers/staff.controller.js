/**
 * Staff controller — salon owners manage their team.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const Staff = require('../models/Staff');
const Salon = require('../models/Salon');
const User = require('../models/User');
const { notifyUser } = require('../services/notification.service');

async function assertOwnsSalon(user, salonId) {
  const salon = await Salon.findById(salonId);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== user._id.toString() && user.role !== 'admin') {
    throw ApiError.forbidden('You can only manage your own salon staff');
  }
  return salon;
}

// GET /api/v1/staff?salon=
exports.list = asyncHandler(async (req, res) => {
  if (!req.query.salon) throw ApiError.badRequest('salon query param required');
  const staff = await Staff.find({ salon: req.query.salon, active: true });
  sendResponse(res, 200, 'Staff', { count: staff.length, staff });
});

// POST /api/v1/staff  (owner)
// If a phone is given, we find-or-create a linked User account with role
// 'staff' so the stylist can log into the partner app and receive
// bookings, chat and calls. `linkSelf: true` is a special case — the owner
// adding THEMSELVES as a bookable stylist (Settings toggle) — we link
// straight to req.user._id since they're already authenticated, no phone
// lookup needed (covers owners with no phone, e.g. Google/email-only accounts).
exports.create = asyncHandler(async (req, res) => {
  const { salon, name, phone, linkSelf } = req.body;
  if (!salon || !name) throw ApiError.badRequest('salon and name are required');
  await assertOwnsSalon(req.user, salon);

  let userId;
  if (linkSelf) {
    userId = req.user._id;
    // keep the owner's own role/roles untouched — this is a booking-list
    // link, not a login-role change (see resolveLoginRole in auth.controller.js)
  } else if (phone) {
    if (!/^[6-9]\d{9}$/.test(phone)) throw ApiError.badRequest('Enter a valid mobile number');
    let staffUser = await User.findOne({ phone });
    if (!staffUser) {
      staffUser = await User.create({ phone, name, role: 'staff' });
    } else if (staffUser.role === 'customer') {
      // upgrade an existing customer account to also act as staff
      staffUser.role = 'staff';
      await staffUser.save();
    }
    userId = staffUser._id;
    notifyUser(userId, {
      title: 'You were added to a salon 💇',
      body: `${name}, you can now log into the GlowOra Partner app to see your bookings.`,
      type: 'system',
    });
  }

  const { avatar, specialities, status, active } = req.body;
  const staff = await Staff.create({ salon, name, phone, avatar, specialities, status, active, user: userId });
  sendResponse(res, 201, 'Staff added', { staff });
});

// PATCH /api/v1/staff/:id  (owner)
exports.update = asyncHandler(async (req, res) => {
  const staff = await Staff.findById(req.params.id);
  if (!staff) throw ApiError.notFound('Staff not found');
  await assertOwnsSalon(req.user, staff.salon);
  const allowed = ['name', 'phone', 'avatar', 'specialities', 'status', 'active'];
  allowed.forEach((k) => { if (req.body[k] !== undefined) staff[k] = req.body[k]; });
  await staff.save();
  sendResponse(res, 200, 'Staff updated', { staff });
});

// DELETE /api/v1/staff/:id  (owner — soft delete)
exports.remove = asyncHandler(async (req, res) => {
  const staff = await Staff.findById(req.params.id);
  if (!staff) throw ApiError.notFound('Staff not found');
  await assertOwnsSalon(req.user, staff.salon);
  staff.active = false;
  await staff.save();
  sendResponse(res, 200, 'Staff removed');
});
