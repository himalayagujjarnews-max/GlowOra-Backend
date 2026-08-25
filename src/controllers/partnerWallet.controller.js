/**
 * Partner wallet controller — internal wallet for salon owners & staff.
 *
 * Flow: online-paid booking earnings land in the SALON's wallet first (see
 * booking.controller.js's updateStatus, which calls creditSalonWallet below).
 * The owner can then send a staff member's share from the salon wallet into
 * that staff member's own wallet (transferToStaff). Both wallets settle to
 * their linked bank account automatically the next day via
 * scheduler.service.js `runWalletSettlement`, but only once bankVerified is
 * true (admin-reviewed — see salon.controller.js `verifyBank` /
 * staff.controller.js `updateBank`).
 *
 * All balance-changing operations here use atomic findOneAndUpdate with a
 * `$gte` balance guard in the filter (never read-then-write), matching the
 * pattern already established in wallet.controller.js's debitWallet — this
 * is the only safe way to avoid a race condition double-spending a wallet.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const { getPagination, buildMeta } = require('../utils/pagination');
const Salon = require('../models/Salon');
const Staff = require('../models/Staff');
const PartnerWalletTransaction = require('../models/PartnerWalletTransaction');

// Resolve "which wallet does this logged-in user own" — a staff-role user
// owns their own Staff doc's wallet; an owner/admin owns a Salon's wallet
// (picking a specific one via ?salon= when they run multiple branches, else
// their first salon).
async function resolveOwnWallet(req) {
  if (req.user.role === 'staff') {
    const staff = await Staff.findOne({ user: req.user._id });
    if (!staff) throw ApiError.notFound('Staff record not found for this account');
    return { ownerType: 'staff', doc: staff };
  }
  const salonId = req.query.salon || req.body.salon;
  let salon;
  if (salonId) {
    salon = await Salon.findById(salonId);
    if (!salon) throw ApiError.notFound('Salon not found');
    if (salon.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      throw ApiError.forbidden('Not your salon');
    }
  } else {
    salon = await Salon.findOne({ owner: req.user._id }).sort({ createdAt: 1 });
    if (!salon) throw ApiError.notFound('No salon found for this account');
  }
  return { ownerType: 'salon', doc: salon };
}

// GET /api/v1/partner-wallet/mine?salon=  (owner/admin or staff)
exports.getMine = asyncHandler(async (req, res) => {
  const { ownerType, doc } = await resolveOwnWallet(req);
  sendResponse(res, 200, 'Wallet', {
    ownerType,
    ownerId: doc._id,
    walletBalance: doc.walletBalance,
    bankVerified: doc.bankVerified,
  });
});

// GET /api/v1/partner-wallet/transactions?salon=&page=&limit=
exports.transactions = asyncHandler(async (req, res) => {
  const { ownerType, doc } = await resolveOwnWallet(req);
  const { page, limit, skip } = getPagination(req.query);
  const filter = { ownerType, owner: doc._id };
  const [txns, total] = await Promise.all([
    PartnerWalletTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    PartnerWalletTransaction.countDocuments(filter),
  ]);
  sendResponse(res, 200, 'Wallet transactions', { transactions: txns }, buildMeta(page, limit, total));
});

// POST /api/v1/partner-wallet/transfer-to-staff  { staffId, amount, note, salon? }  (owner/admin)
// Owner pays a staff member out of their own salon wallet — an in-app peer
// transfer, not a bank transaction. Fully atomic and fully logged on both
// sides (see module docstring above).
exports.transferToStaff = asyncHandler(async (req, res) => {
  const { staffId, note } = req.body;
  const amount = Number(req.body.amount);
  if (!staffId || !amount || amount <= 0) throw ApiError.badRequest('staffId and a positive amount are required');

  const staff = await Staff.findById(staffId);
  if (!staff) throw ApiError.notFound('Staff not found');
  const salon = await Salon.findById(staff.salon);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw ApiError.forbidden('You can only pay your own staff');
  }

  const updatedSalon = await Salon.findOneAndUpdate(
    { _id: salon._id, walletBalance: { $gte: amount } },
    { $inc: { walletBalance: -amount } },
    { new: true }
  );
  if (!updatedSalon) throw ApiError.badRequest('Insufficient wallet balance');

  const updatedStaff = await Staff.findByIdAndUpdate(
    staff._id,
    { $inc: { walletBalance: amount } },
    { new: true }
  );

  await PartnerWalletTransaction.create({
    ownerType: 'salon', owner: salon._id, type: 'debit', amount,
    balanceAfter: updatedSalon.walletBalance, source: 'transfer_out',
    description: note || `Sent to ${staff.name}`, createdBy: req.user._id, reference: staff._id,
  });
  await PartnerWalletTransaction.create({
    ownerType: 'staff', owner: staff._id, type: 'credit', amount,
    balanceAfter: updatedStaff.walletBalance, source: 'transfer_in',
    description: note || `Received from ${salon.name}`, createdBy: req.user._id, reference: salon._id,
  });

  sendResponse(res, 200, 'Sent to staff wallet', {
    salonWalletBalance: updatedSalon.walletBalance,
    staffWalletBalance: updatedStaff.walletBalance,
  });
});

// ---- Exported helpers reused elsewhere (booking.controller.js, scheduler.service.js) ----

// Credit a salon's wallet — used when an online-paid booking completes.
module.exports.creditSalonWallet = async function creditSalonWallet(salonId, amount, source, description, reference) {
  if (!amount || amount <= 0) return null;
  const salon = await Salon.findByIdAndUpdate(salonId, { $inc: { walletBalance: amount } }, { new: true });
  if (!salon) return null;
  await PartnerWalletTransaction.create({
    ownerType: 'salon', owner: salonId, type: 'credit', amount,
    balanceAfter: salon.walletBalance, source, description, reference,
  });
  return salon.walletBalance;
};

// Debit a salon's wallet — used by the T+1 settlement job. Returns null (no
// throw) if the guard fails, so callers can just skip that salon this run.
module.exports.debitSalonWallet = async function debitSalonWallet(salonId, amount, source, description, reference) {
  const salon = await Salon.findOneAndUpdate(
    { _id: salonId, walletBalance: { $gte: amount } },
    { $inc: { walletBalance: -amount } },
    { new: true }
  );
  if (!salon) return null;
  await PartnerWalletTransaction.create({
    ownerType: 'salon', owner: salonId, type: 'debit', amount,
    balanceAfter: salon.walletBalance, source, description, reference,
  });
  return salon.walletBalance;
};

// Debit a staff member's wallet — used by the T+1 settlement job.
module.exports.debitStaffWallet = async function debitStaffWallet(staffId, amount, source, description, reference) {
  const staff = await Staff.findOneAndUpdate(
    { _id: staffId, walletBalance: { $gte: amount } },
    { $inc: { walletBalance: -amount } },
    { new: true }
  );
  if (!staff) return null;
  await PartnerWalletTransaction.create({
    ownerType: 'staff', owner: staffId, type: 'debit', amount,
    balanceAfter: staff.walletBalance, source, description, reference,
  });
  return staff.walletBalance;
};
