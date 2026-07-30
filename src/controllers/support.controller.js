/**
 * Support controller — customers raise tickets; admin resolves.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const { getPagination, buildMeta } = require('../utils/pagination');
const SupportTicket = require('../models/SupportTicket');

// POST /support   { subject, category, booking?, message }
exports.create = asyncHandler(async (req, res) => {
  const { subject, message } = req.body;
  if (!subject || !message) throw ApiError.badRequest('subject and message are required');
  const ticket = await SupportTicket.create({
    user: req.user._id,
    subject,
    category: req.body.category,
    booking: req.body.booking,
    messages: [{ sender: req.user._id, fromSupport: false, text: message }],
  });
  sendResponse(res, 201, 'Ticket created', { ticket });
});

// GET /support/mine
exports.mine = asyncHandler(async (req, res) => {
  const tickets = await SupportTicket.find({ user: req.user._id }).sort({ createdAt: -1 });
  sendResponse(res, 200, 'Your tickets', { tickets });
});

// GET /support/:id
exports.getOne = asyncHandler(async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound('Ticket not found');
  if (ticket.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw ApiError.forbidden('Not your ticket');
  }
  sendResponse(res, 200, 'Ticket', { ticket });
});

// POST /support/:id/reply   { text }
exports.reply = asyncHandler(async (req, res) => {
  const ticket = await SupportTicket.findById(req.params.id);
  if (!ticket) throw ApiError.notFound('Ticket not found');
  const isOwner = ticket.user.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isAdmin) throw ApiError.forbidden('Not allowed');
  ticket.messages.push({ sender: req.user._id, fromSupport: isAdmin, text: req.body.text });
  if (isAdmin && ticket.status === 'open') ticket.status = 'in_progress';
  await ticket.save();
  sendResponse(res, 200, 'Reply added', { ticket });
});

// ---- Admin ----
// GET /support?status=&page=
exports.adminList = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const [tickets, total] = await Promise.all([
    SupportTicket.find(filter).populate('user', 'name phone').sort({ createdAt: -1 }).skip(skip).limit(limit),
    SupportTicket.countDocuments(filter),
  ]);
  sendResponse(res, 200, 'Tickets', { tickets }, buildMeta(page, limit, total));
});

// PATCH /support/:id/status   { status }  (admin)
exports.setStatus = asyncHandler(async (req, res) => {
  const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
  if (!ticket) throw ApiError.notFound('Ticket not found');
  sendResponse(res, 200, 'Status updated', { ticket });
});
