/**
 * Privacy controller — GDPR / India DPDP compliance:
 *  - consent capture & history
 *  - full data export (right to access / portability)
 *  - account anonymisation (right to erasure)
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const User = require('../models/User');
const ConsentLog = require('../models/ConsentLog');
const Booking = require('../models/Booking');
const Address = require('../models/Address');
const Payment = require('../models/Payment');
const Review = require('../models/Review');
const WalletTransaction = require('../models/WalletTransaction');
const Order = require('../models/Order');
const FamilyMember = require('../models/FamilyMember');
const sessionService = require('../services/session.service');

// POST /privacy/consent   { type, version, granted }
exports.recordConsent = asyncHandler(async (req, res) => {
  const { type, version, granted } = req.body;
  if (!type || !version || granted === undefined) {
    throw ApiError.badRequest('type, version and granted are required');
  }
  await ConsentLog.create({
    user: req.user._id, type, version, granted,
    ip: req.ip, userAgent: req.headers['user-agent'],
  });
  // reflect latest on user doc
  const update = {};
  if (type === 'terms' || type === 'privacy') update.consentVersion = version;
  if (type === 'marketing') update.marketingConsent = granted;
  if (Object.keys(update).length) await User.findByIdAndUpdate(req.user._id, update);
  sendResponse(res, 200, 'Consent recorded');
});

// GET /privacy/consent  — my consent history
exports.consentHistory = asyncHandler(async (req, res) => {
  const history = await ConsentLog.find({ user: req.user._id }).sort({ createdAt: -1 });
  sendResponse(res, 200, 'Consent history', { history });
});

// GET /privacy/export  — download all my data (JSON)
exports.exportData = asyncHandler(async (req, res) => {
  const uid = req.user._id;
  const [user, bookings, addresses, payments, reviews, wallet, orders, family, consents] = await Promise.all([
    User.findById(uid),
    Booking.find({ customer: uid }),
    Address.find({ user: uid }),
    Payment.find({ customer: uid }),
    Review.find({ customer: uid }),
    WalletTransaction.find({ user: uid }),
    Order.find({ customer: uid }),
    FamilyMember.find({ user: uid }),
    ConsentLog.find({ user: uid }),
  ]);

  await User.findByIdAndUpdate(uid, { dataExportRequestedAt: new Date() });

  const profile = user.toObject();
  delete profile.password;
  delete profile.twoFactorSecret;
  delete profile.twoFactorBackupCodes;

  sendResponse(res, 200, 'Your data export', {
    exportedAt: new Date(),
    profile, bookings, addresses, payments, reviews,
    walletTransactions: wallet, orders, familyMembers: family, consents,
  });
});

// DELETE /privacy/erase   { confirm: "DELETE" }  — right to be forgotten
exports.eraseAccount = asyncHandler(async (req, res) => {
  if (req.body.confirm !== 'DELETE') {
    throw ApiError.badRequest('Send { "confirm": "DELETE" } to permanently erase your account');
  }
  const uid = req.user._id;

  // Anonymise rather than hard-delete so financial/audit records stay consistent.
  const anon = `deleted_${uid.toString().slice(-6)}`;
  await User.findByIdAndUpdate(uid, {
    $set: {
      name: 'Deleted User',
      phone: `0${uid.toString().slice(-9)}`, // keep unique, unusable
      active: false,
      anonymizedAt: new Date(),
      fcmTokens: [],
      twoFactorEnabled: false,
      twoFactorBackupCodes: [],
      blockedReason: 'account_erased',
    },
    // undefined assignments are dropped silently by Mongoose/MongoDB on save/update,
    // so PII fields must be explicitly $unset to actually remove them from the document.
    $unset: {
      email: 1,
      avatar: 1,
      avatarPublicId: 1,
      twoFactorSecret: 1,
    },
  });
  await Address.deleteMany({ user: uid });
  await FamilyMember.deleteMany({ user: uid });
  await sessionService.revokeAll(uid, null, 'account_erased');

  sendResponse(res, 200, 'Your account has been erased. Financial records are retained per law but anonymised.');
});
