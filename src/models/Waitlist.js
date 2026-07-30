/**
 * Waitlist — a customer waiting for a fully-booked slot/date at a salon.
 * When a matching slot frees up (a booking is cancelled), the earliest
 * waiters are notified.
 */
const mongoose = require('mongoose');

const waitlistSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    staff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' }, // optional preferred stylist
    serviceIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],
    date: { type: String, required: true }, // 'YYYY-MM-DD'
    preferredTime: { type: String }, // 'HH:mm' optional
    status: { type: String, enum: ['waiting', 'notified', 'converted', 'expired', 'cancelled'], default: 'waiting', index: true },
    notifiedAt: { type: Date },
  },
  { timestamps: true }
);

waitlistSchema.index({ salon: 1, date: 1, status: 1 });

module.exports = mongoose.model('Waitlist', waitlistSchema);
