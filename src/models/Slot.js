/**
 * Slot — a bookable time window for a staff member on a given date.
 * Prevents double-booking via a unique compound index.
 */
const mongoose = require('mongoose');

const slotSchema = new mongoose.Schema(
  {
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    // Not required — booking.controller.js's create() allows `staff: null`
    // when a salon has zero active stylists, so a slot must be able to
    // represent that too. The unique index below uses a partialFilterExpression
    // so multiple null-staff slots (across different staffless salons, or
    // even the same one) never collide against each other.
    staff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', index: true },
    date: { type: String, required: true }, // 'YYYY-MM-DD'
    startTime: { type: String, required: true }, // 'HH:mm'
    endTime: { type: String, required: true },
    status: { type: String, enum: ['available', 'held', 'booked', 'blocked'], default: 'available' },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    holdExpiresAt: { type: Date }, // for temporary holds during checkout
  },
  { timestamps: true }
);

// A staff member cannot have two slots at the same date+time. Only enforced
// when `staff` is actually set — staffless-salon slots (staff: null) are
// exempted via partialFilterExpression so they don't falsely collide with
// each other (a unique index on a nullable field otherwise treats every
// `null` as "the same value").
slotSchema.index(
  { staff: 1, date: 1, startTime: 1 },
  { unique: true, partialFilterExpression: { staff: { $type: 'objectId' } } }
);
slotSchema.index({ salon: 1, date: 1 });

module.exports = mongoose.model('Slot', slotSchema);
