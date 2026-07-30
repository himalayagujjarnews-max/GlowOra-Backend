/**
 * Address controller — customer saved addresses.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const Address = require('../models/Address');

// GET /addresses
exports.list = asyncHandler(async (req, res) => {
  const addresses = await Address.find({ user: req.user._id }).sort({ isDefault: -1, createdAt: -1 });
  sendResponse(res, 200, 'Addresses', { addresses });
});

// POST /addresses
exports.create = asyncHandler(async (req, res) => {
  const { line1, city } = req.body;
  if (!line1 || !city) throw ApiError.badRequest('line1 and city are required');
  const count = await Address.countDocuments({ user: req.user._id });
  const isDefault = req.body.isDefault || count === 0;
  if (isDefault) await Address.updateMany({ user: req.user._id }, { isDefault: false });
  const address = await Address.create({ ...req.body, user: req.user._id, isDefault });
  sendResponse(res, 201, 'Address added', { address });
});

// PATCH /addresses/:id
exports.update = asyncHandler(async (req, res) => {
  const address = await Address.findOne({ _id: req.params.id, user: req.user._id });
  if (!address) throw ApiError.notFound('Address not found');
  if (req.body.isDefault) await Address.updateMany({ user: req.user._id }, { isDefault: false });
  const allowed = ['label', 'line1', 'line2', 'landmark', 'city', 'state', 'pincode', 'location', 'isDefault'];
  allowed.forEach((k) => { if (req.body[k] !== undefined) address[k] = req.body[k]; });
  await address.save();
  sendResponse(res, 200, 'Address updated', { address });
});

// DELETE /addresses/:id
exports.remove = asyncHandler(async (req, res) => {
  const address = await Address.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!address) throw ApiError.notFound('Address not found');
  sendResponse(res, 200, 'Address removed');
});
