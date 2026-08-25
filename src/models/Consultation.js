/**
 * Consultation — a customer's pre-booking video/voice consultation request
 * with a specific stylist, before any Booking exists. Once a staff/owner
 * accepts, both sides get an Agora token for a room named `consultation_<id>`
 * (see consultation.controller.js's `respond`, which reuses the same
 * `buildRtcToken` helper call.controller.js uses for booking calls).
 */
const mongoose = require('mongoose');

const consultationSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    staff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true, index: true },
    status: {
      type: String,
      enum: ['requested', 'accepted', 'completed', 'declined'],
      default: 'requested',
      index: true,
    },
    // optional preferred time; null/undefined means "ASAP"
    scheduledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

consultationSchema.index({ salon: 1, status: 1, createdAt: -1 });
consultationSchema.index({ customer: 1, createdAt: -1 });

module.exports = mongoose.model('Consultation', consultationSchema);
