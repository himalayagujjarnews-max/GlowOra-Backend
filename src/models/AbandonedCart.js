/**
 * AbandonedCart — tracks a customer reaching the Booking screen with
 * services selected but not (yet) completing the booking. One doc per
 * user+salon; the controller upserts on every screen visit so repeat visits
 * refresh the timestamp instead of piling up duplicates. Consumed by the
 * abandoned-cart reminder job in scheduler.service.js, and deleted outright
 * by booking.controller.js's create() once the booking actually goes through.
 */
const mongoose = require('mongoose');

const abandonedCartSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    services: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],
    staff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' }, // optional — "Any stylist" leaves this unset
    reminded: { type: Boolean, default: false }, // set once the nudge notification has fired
  },
  { timestamps: true }
);

// one open cart per user+salon — the controller upserts against this
abandonedCartSchema.index({ user: 1, salon: 1 }, { unique: true });

module.exports = mongoose.model('AbandonedCart', abandonedCartSchema);
