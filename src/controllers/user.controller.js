/**
 * User controller — profile management, avatar, wallet view, admin user ops.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const { getPagination, buildMeta } = require('../utils/pagination');
const { uploadImage, deleteImage } = require('../config/cloudinary');
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');

// GET /users/profile
exports.getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  sendResponse(res, 200, 'Profile', { user });
});

// PATCH /users/profile   { name, email, gender, dob, city, location }
exports.updateProfile = asyncHandler(async (req, res) => {
  const allowed = ['name', 'email', 'gender', 'dob', 'city', 'location', 'notificationsEnabled'];
  const update = {};
  allowed.forEach((k) => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
  const user = await User.findByIdAndUpdate(req.user._id, update, { new: true, runValidators: true });
  sendResponse(res, 200, 'Profile updated', { user });
});

// POST /users/avatar   (multipart: image)
exports.updateAvatar = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('Image file required');
  const user = await User.findById(req.user._id);
  if (user.avatarPublicId) await deleteImage(user.avatarPublicId);
  const { url, publicId } = await uploadImage(req.file.buffer, 'glowora/avatars');
  user.avatar = url;
  user.avatarPublicId = publicId;
  await user.save();
  sendResponse(res, 200, 'Avatar updated', { avatar: url });
});

// GET /users/wallet
exports.getWallet = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const [txns, total, user] = await Promise.all([
    WalletTransaction.find({ user: req.user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    WalletTransaction.countDocuments({ user: req.user._id }),
    User.findById(req.user._id).select('walletBalance glowPoints'),
  ]);
  sendResponse(res, 200, 'Wallet', {
    balance: user.walletBalance, glowPoints: user.glowPoints, transactions: txns,
  }, buildMeta(page, limit, total));
});

// DELETE /users/me   (soft — deactivate)
exports.deleteAccount = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { active: false, blockedReason: 'self_deleted' });
  sendResponse(res, 200, 'Account deactivated');
});

// ---- Admin ----
// GET /users?role=&search=&page=&limit=
exports.adminList = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.search) {
    filter.$or = [
      { name: new RegExp(req.query.search, 'i') },
      { phone: new RegExp(req.query.search, 'i') },
    ];
  }
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  sendResponse(res, 200, 'Users', { users }, buildMeta(page, limit, total));
});

// PATCH /users/:id/block   { block: true|false, reason }  (admin)
exports.setBlock = asyncHandler(async (req, res) => {
  const { block, reason } = req.body;
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { active: !block, blockedReason: block ? reason : undefined },
    { new: true }
  );
  if (!user) throw ApiError.notFound('User not found');
  sendResponse(res, 200, block ? 'User blocked' : 'User unblocked', { user });
});

// POST /users/:id/wallet-adjust   { amount, description }  (admin)
exports.adjustWallet = asyncHandler(async (req, res) => {
  const { amount, description } = req.body;
  if (!amount) throw ApiError.badRequest('amount required (positive to credit, negative to debit)');
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  const newBal = user.walletBalance + amount;
  if (newBal < 0) throw ApiError.badRequest('Insufficient balance for this debit');
  user.walletBalance = newBal;
  await user.save();
  await WalletTransaction.create({
    user: user._id,
    type: amount >= 0 ? 'credit' : 'debit',
    amount: Math.abs(amount),
    balanceAfter: newBal,
    source: 'admin_adjust',
    description: description || 'Admin adjustment',
  });
  sendResponse(res, 200, 'Wallet updated', { balance: newBal });
});
