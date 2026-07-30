/**
 * Family controller — customers manage members they can book for.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const FamilyMember = require('../models/FamilyMember');

const MAX_MEMBERS = 6;

// GET /family
exports.list = asyncHandler(async (req, res) => {
  const members = await FamilyMember.find({ user: req.user._id }).sort({ createdAt: 1 });
  sendResponse(res, 200, 'Family members', { members });
});

// POST /family
exports.create = asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) throw ApiError.badRequest('name is required');
  const count = await FamilyMember.countDocuments({ user: req.user._id });
  if (count >= MAX_MEMBERS) throw ApiError.badRequest(`You can add up to ${MAX_MEMBERS} family members`);
  const member = await FamilyMember.create({ ...req.body, user: req.user._id });
  sendResponse(res, 201, 'Family member added', { member });
});

// PATCH /family/:id
exports.update = asyncHandler(async (req, res) => {
  const member = await FamilyMember.findOne({ _id: req.params.id, user: req.user._id });
  if (!member) throw ApiError.notFound('Member not found');
  ['name', 'relation', 'gender', 'age', 'phone'].forEach((k) => { if (req.body[k] !== undefined) member[k] = req.body[k]; });
  await member.save();
  sendResponse(res, 200, 'Member updated', { member });
});

// DELETE /family/:id
exports.remove = asyncHandler(async (req, res) => {
  const member = await FamilyMember.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!member) throw ApiError.notFound('Member not found');
  sendResponse(res, 200, 'Member removed');
});
