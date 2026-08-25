/**
 * Chat controller — REST endpoints for conversations & message history.
 * Real-time delivery is handled by Socket.io (see src/socket).
 * Chat is only allowed while the booking is in the confirmed→completed window.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const { getPagination, buildMeta } = require('../utils/pagination');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Booking = require('../models/Booking');
const Salon = require('../models/Salon');
const Staff = require('../models/Staff');

/** Ensure the requester is a participant of the conversation. */
function assertParticipant(conv, userId) {
  const uid = userId.toString();
  const ok = conv.customer.toString() === uid || (conv.staff && conv.staff.toString() === uid);
  if (!ok) throw ApiError.forbidden('You are not part of this conversation');
}

// POST /chat/conversations   { bookingId }  — get or create a thread
exports.openConversation = asyncHandler(async (req, res) => {
  const { bookingId } = req.body;
  const booking = await Booking.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');

  const salon = await Salon.findById(booking.salon);
  const isCustomer = booking.customer.toString() === req.user._id.toString();
  const isOwner = salon && salon.owner.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'admin';
  // Checking role alone (`req.user.role === 'staff'`) let ANY staff account
  // platform-wide open a conversation for ANY booking, not just one they're
  // actually assigned to — an IDOR that leaked this booking's
  // customer/staff/salon ids to unrelated staff. Verify they're the staff
  // member actually linked to this specific booking instead.
  let isAssignedStaff = false;
  if (!isCustomer && !isOwner && !isAdmin && req.user.role === 'staff') {
    const staffDoc = await Staff.findOne({ _id: booking.staff, user: req.user._id }).select('_id');
    isAssignedStaff = Boolean(staffDoc);
  }
  if (!isCustomer && !isOwner && !isAdmin && !isAssignedStaff) {
    throw ApiError.forbidden('Not allowed');
  }
  if (!booking.communicationUnlocked) {
    throw ApiError.forbidden('Chat is available only after confirmation and before completion.');
  }

  // resolve staff user account if linked
  const staffDoc = await Staff.findById(booking.staff);
  const staffUser = staffDoc && staffDoc.user ? staffDoc.user : salon.owner;

  let conv = await Conversation.findOne({ booking: booking._id });
  if (!conv) {
    conv = await Conversation.create({
      booking: booking._id,
      customer: booking.customer,
      staff: staffUser,
      salon: booking.salon,
    });
  }
  sendResponse(res, 200, 'Conversation', { conversation: conv });
});

// GET /chat/conversations   — list my conversations
exports.myConversations = asyncHandler(async (req, res) => {
  const uid = req.user._id;
  const convs = await Conversation.find({ $or: [{ customer: uid }, { staff: uid }] })
    .populate('salon', 'name coverImage')
    .populate('booking', 'bookingCode date status')
    .sort({ lastMessageAt: -1 });
  sendResponse(res, 200, 'Conversations', { conversations: convs });
});

// GET /chat/conversations/:id/messages
exports.messages = asyncHandler(async (req, res) => {
  const conv = await Conversation.findById(req.params.id);
  if (!conv) throw ApiError.notFound('Conversation not found');
  assertParticipant(conv, req.user._id);

  const { page, limit, skip } = getPagination(req.query, 30);
  const [items, total] = await Promise.all([
    Message.find({ conversation: conv._id }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Message.countDocuments({ conversation: conv._id }),
  ]);

  // mark incoming as read
  const isCustomer = conv.customer.toString() === req.user._id.toString();
  await Message.updateMany({ conversation: conv._id, sender: { $ne: req.user._id }, read: false }, { read: true });
  if (isCustomer) { conv.unreadCustomer = 0; } else { conv.unreadStaff = 0; }
  await conv.save();

  sendResponse(res, 200, 'Messages', { messages: items.reverse() }, buildMeta(page, limit, total));
});

// POST /chat/conversations/:id/messages   { text, attachment? }
// (REST fallback; primary path is socket)
exports.sendMessage = asyncHandler(async (req, res) => {
  const conv = await Conversation.findById(req.params.id).populate('booking', 'communicationUnlocked');
  if (!conv) throw ApiError.notFound('Conversation not found');
  assertParticipant(conv, req.user._id);
  if (conv.locked || (conv.booking && !conv.booking.communicationUnlocked)) {
    throw ApiError.forbidden('This conversation is closed.');
  }
  const { text, attachment } = req.body;
  if (!text && !attachment) throw ApiError.badRequest('Message text or attachment required');

  const isCustomer = conv.customer.toString() === req.user._id.toString();
  const message = await Message.create({
    conversation: conv._id,
    sender: req.user._id,
    senderRole: isCustomer ? 'customer' : req.user.role,
    text, attachment,
    type: attachment ? 'image' : 'text',
  });
  conv.lastMessage = text || '📷 Photo';
  conv.lastMessageAt = new Date();
  if (isCustomer) conv.unreadStaff += 1; else conv.unreadCustomer += 1;
  await conv.save();

  sendResponse(res, 201, 'Message sent', { message });
});
