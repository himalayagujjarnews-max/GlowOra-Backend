/**
 * Conversation — a chat thread between customer & staff/owner, either tied
 * to a booking (locked outside the confirmed->completed window) OR a
 * booking-less pre-booking "inquiry" thread (booking left unset) so a
 * customer can ask a salon about customization/timing before ever booking.
 * See chat.controller.js openInquiry/openConversation for the two paths.
 */
const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' }, // unset for pre-booking inquiries
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

// One thread per real booking — only enforced when `booking` is actually
// set, so booking-less inquiry threads (see below) aren't affected.
conversationSchema.index(
  { booking: 1 },
  { unique: true, partialFilterExpression: { booking: { $type: 'objectId' } } }
);
// Fast lookup for "does this customer already have an inquiry thread with
// this salon" (chat.controller.js openInquiry) — not unique at the DB level,
// enforced by find-before-create in the controller (same convention as the
// rest of this codebase, which doesn't use DB transactions anywhere yet).
conversationSchema.index({ customer: 1, salon: 1 });

module.exports = mongoose.model('Conversation', conversationSchema);
