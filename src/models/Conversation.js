/**
 * Conversation — a chat thread tied to a booking, between customer & staff.
 * Locked outside the confirmed→completed window.
 */
const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    staff: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, // staff's user account
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true },
    lastMessage: { type: String },
    lastMessageAt: { type: Date },
    unreadCustomer: { type: Number, default: 0 },
    unreadStaff: { type: Number, default: 0 },
    locked: { type: Boolean, default: false }, // true after completion/cancel
  },
  { timestamps: true }
);

module.exports = mongoose.model('Conversation', conversationSchema);
