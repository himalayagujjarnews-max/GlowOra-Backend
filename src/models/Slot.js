/**
 * Slot — a bookable time window for a staff member on a given date.
 * Prevents double-booking via a unique compound index.
 */
const mongoose = require('mongoose');

const slotSchema = new mongoose.Schema(
  {
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    staff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true, index: true },
    date: { type: String, required: true }, // 'YYYY-MM-DD'
    startTime: { type: String, required: true }, // 'HH:mm'
    endTime: { type: String, required: true },
    status: { type: String, enum: ['available', 'held', 'booked', 'blocked'], default: 'available' },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    holdExpiresAt: { type: Date }, // for temporary holds during checkout
  },
  { timestamps: true }
);

// A staff member cannot have two slots at the same date+time.
slotSchema.index({ staff: 1, date: 1, startTime: 1 }, { unique: true });
slotSchema.index({ salon: 1, date: 1 });

module.exports = mongoose.model('Slot', slotSchema);
