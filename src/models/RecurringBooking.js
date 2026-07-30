/**
 * RecurringBooking — a customer's standing order (e.g. haircut every 4 weeks).
 * A scheduler (cron) reads due ones and creates real bookings.
 */
const mongoose = require('mongoose');

const recurringBookingSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true },
    staff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
    serviceIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true }],
    frequency: { type: String, enum: ['weekly', 'biweekly', 'monthly'], required: true },
    preferredTime: { type: String, required: true }, // 'HH:mm'
    paymentMode: { type: String, enum: ['token', 'full_online', 'at_salon', 'wallet'], default: 'at_salon' },
    nextRunDate: { type: String, required: true, index: true }, // 'YYYY-MM-DD'
    lastBookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RecurringBooking', recurringBookingSchema);
