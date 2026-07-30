/**
 * Notification controller — user's in-app feed + read state.
 */
const asyncHandler = require('../utils/asyncHandler');
const sendResponse = require('../utils/ApiResponse');
const { getPagination, buildMeta } = require('../utils/pagination');
const Notification = require('../models/Notification');

// GET /notifications
exports.list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = { $or: [{ user: req.user._id }, { user: null }] };
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: req.user._id, read: false }),
  ]);
  sendResponse(res, 200, 'Notifications', { notifications: items, unread }, buildMeta(page, limit, total));
});

// PATCH /notifications/:id/read
exports.markRead = asyncHandler(async (req, res) => {
  await Notification.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { read: true });
  sendResponse(res, 200, 'Marked as read');
});

// PATCH /notifications/read-all
exports.markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, read: false }, { read: true });
  sendResponse(res, 200, 'All marked as read');
});
