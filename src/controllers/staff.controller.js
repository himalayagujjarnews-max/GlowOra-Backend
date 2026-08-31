/**
 * Staff controller — salon owners manage their team.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const Staff = require('../models/Staff');
const Salon = require('../models/Salon');
const User = require('../models/User');
const Booking = require('../models/Booking');
const { notifyUser } = require('../services/notification.service');
const { uploadImage } = require('../config/cloudinary');
const { localYmd } = require('../utils/helpers');

async function assertOwnsSalon(user, salonId) {
  const salon = await Salon.findById(salonId);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== user._id.toString() && user.role !== 'admin') {
    throw ApiError.forbidden('You can only manage your own salon staff');
  }
  return salon;
}

// Portfolio access: the salon owner (or admin), OR the staff member managing
// their OWN Staff doc (same self-access pattern as shift.controller.js's
// assertAllowed / booking.controller.js's isAssignedStaff — resolved via the
// linked `user` field rather than role alone, since 'staff' role alone
// doesn't prove it's THIS staff doc).
async function assertCanManagePortfolio(user, staff) {
  const salon = await Salon.findById(staff.salon);
  if (!salon) throw ApiError.notFound('Salon not found');
  const isOwner = salon.owner.toString() === user._id.toString();
  const isAdmin = user.role === 'admin';
  const isSelf = user.role === 'staff' && staff.user && staff.user.toString() === user._id.toString();
  if (!isOwner && !isAdmin && !isSelf) {
    throw ApiError.forbidden('You can only manage your own portfolio');
  }
}

// GET /api/v1/staff/mine  (staff — resolves the logged-in staff's own Staff
// record(s) + salon, so the partner app doesn't need a separate lookup to
// know "which salon/staff am I" before fetching e.g. their own roster).
exports.mine = asyncHandler(async (req, res) => {
  const staff = await Staff.find({ user: req.user._id }).populate('salon', 'name');
  sendResponse(res, 200, 'Your staff record', { count: staff.length, staff });
});

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
  const allowed = ['name', 'phone', 'avatar', 'specialities', 'status', 'active', 'commissionPercent'];
  allowed.forEach((k) => { if (req.body[k] !== undefined) staff[k] = req.body[k]; });
  await staff.save();
  sendResponse(res, 200, 'Staff updated', { staff });
});

// DELETE /api/v1/staff/:id  (owner — soft delete)
exports.remove = asyncHandler(async (req, res) => {
  const staff = await Staff.findById(req.params.id);
  if (!staff) throw ApiError.notFound('Staff not found');
  await assertOwnsSalon(req.user, staff.salon);

  // Don't let an owner silently strand upcoming bookings on a now-inactive
  // staff member — they must reassign/cancel those bookings first (via the
  // existing reschedule/cancel endpoints) before this soft-delete is allowed.
  const upcomingBookings = await Booking.countDocuments({
    staff: staff._id,
    status: { $in: ['pending', 'confirmed', 'in_progress'] },
    date: { $gte: localYmd() },
  });
  if (upcomingBookings > 0) {
    throw ApiError.badRequest(
      `This staff member has ${upcomingBookings} upcoming booking(s). Please reassign or cancel them before removing this staff member.`
    );
  }

  staff.active = false;
  await staff.save();
  sendResponse(res, 200, 'Staff removed');
});

// POST /api/v1/staff/:id/portfolio  (owner or the staff member themselves)
// Multipart: two named fields `before` and `after` (one file each — see
// upload.fields() in staff.routes.js) plus a text field `caption`. Mirrors
// salon.controller.js's uploadImages (same multer memoryStorage + uploadImage
// cloudinary helper), just two named fields instead of one array field since
// before/after are semantically distinct, not an interchangeable gallery.
exports.addPortfolio = asyncHandler(async (req, res) => {
  const staff = await Staff.findById(req.params.id);
  if (!staff) throw ApiError.notFound('Staff not found');
  await assertCanManagePortfolio(req.user, staff);

  const beforeFile = req.files?.before?.[0];
  const afterFile = req.files?.after?.[0];
  if (!beforeFile || !afterFile) throw ApiError.badRequest('Both before and after images are required');

  const [beforeUpload, afterUpload] = await Promise.all([
    uploadImage(beforeFile.buffer, 'glowora/portfolio'),
    uploadImage(afterFile.buffer, 'glowora/portfolio'),
  ]);

  staff.portfolio.push({
    before: beforeUpload.url,
    after: afterUpload.url,
    caption: req.body.caption,
  });
  await staff.save();
  sendResponse(res, 201, 'Portfolio entry added', { staff });
});

// Bank details access: owner/admin, OR the staff member managing their OWN
// record — same self-access pattern as assertCanManagePortfolio above.
async function assertCanManageBank(user, staff) {
  const salon = await Salon.findById(staff.salon);
  if (!salon) throw ApiError.notFound('Salon not found');
  const isOwner = salon.owner.toString() === user._id.toString();
  const isAdmin = user.role === 'admin';
  const isSelf = user.role === 'staff' && staff.user && staff.user.toString() === user._id.toString();
  if (!isOwner && !isAdmin && !isSelf) {
    throw ApiError.forbidden('You can only manage your own bank details');
  }
}

// GET /api/v1/staff/:id/bank  (owner/admin or the staff member themselves)
exports.getBank = asyncHandler(async (req, res) => {
  const staff = await Staff.findById(req.params.id).select('+bankDetails salon user name walletBalance bankVerified');
  if (!staff) throw ApiError.notFound('Staff not found');
  await assertCanManageBank(req.user, staff);
  sendResponse(res, 200, 'Bank details', { staff });
});

// PATCH /api/v1/staff/:id/bank  (owner/admin or the staff member themselves)
// Changing bank details resets bankVerified — a changed account number must
// be re-checked by admin before it's eligible for auto-settlement again
// (mirrors the intent, if not yet the mechanism, of a real bank-verification flow).
exports.updateBank = asyncHandler(async (req, res) => {
  const staff = await Staff.findById(req.params.id).select('+bankDetails salon user bankVerified');
  if (!staff) throw ApiError.notFound('Staff not found');
  await assertCanManageBank(req.user, staff);
  const { accountName, accountNumber, ifsc, upiId } = req.body;
  staff.bankDetails = { accountName, accountNumber, ifsc, upiId };
  staff.bankVerified = false;
  await staff.save();
  sendResponse(res, 200, 'Bank details updated — pending verification', { staff });
});

// GET /api/v1/staff/admin/pending-bank  (admin) — staff who've submitted bank
// details but aren't verified yet, for the admin bank-verification queue.
exports.pendingBankVerification = asyncHandler(async (req, res) => {
  const staff = await Staff.find({
    'bankDetails.accountNumber': { $exists: true, $ne: null, $nin: ['', null] },
    bankVerified: false,
  })
    .select('+bankDetails name salon user bankVerified')
    .populate('salon', 'name')
    .sort({ updatedAt: -1 })
    .limit(500); // safety cap — this is an admin review queue, not meant to grow unbounded
  sendResponse(res, 200, 'Staff pending bank verification', { staff });
});

// PATCH /api/v1/staff/:id/verify-bank  { verified: true|false }  (admin)
// Mirrors salon.controller.js's verifyBank — no real bank-API verification,
// admin manually reviews the (decrypted) account details and flips this flag.
exports.verifyBank = asyncHandler(async (req, res) => {
  const staff = await Staff.findByIdAndUpdate(
    req.params.id,
    { bankVerified: req.body.verified !== false },
    { new: true }
  ).select('+bankDetails name bankVerified');
  if (!staff) throw ApiError.notFound('Staff not found');
  sendResponse(res, 200, `Bank account ${staff.bankVerified ? 'verified' : 'unverified'}`, { staff });
});

// DELETE /api/v1/staff/:id/portfolio/:entryId  (owner or the staff member themselves)
exports.removePortfolio = asyncHandler(async (req, res) => {
  const staff = await Staff.findById(req.params.id);
  if (!staff) throw ApiError.notFound('Staff not found');
  await assertCanManagePortfolio(req.user, staff);

  const entry = staff.portfolio.id(req.params.entryId);
  if (!entry) throw ApiError.notFound('Portfolio entry not found');
  entry.deleteOne(); // Mongoose subdocument removal
  await staff.save();
  sendResponse(res, 200, 'Portfolio entry removed', { staff });
});
