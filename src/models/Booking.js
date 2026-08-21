/**
 * Booking — the core transaction linking a customer, salon, staff,
 * service(s) and a slot. Drives chat/call unlock and payment state.
 */
const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
  {
    bookingCode: { type: String, unique: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    staff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
    services: [
      {
        service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service' },
        name: String,
        price: Number,
        durationMinutes: Number,
      },
    ],
    slot: { type: mongoose.Schema.Types.ObjectId, ref: 'Slot' }, // null for walk-ins
    date: { type: String, required: true }, // 'YYYY-MM-DD'
    startTime: { type: String, required: true },

    mode: { type: String, enum: ['salon', 'home'], default: 'salon' },
    address: { type: String }, // required when mode === 'home'
    homeServiceOtp: { type: String, select: false }, // verify stylist arrival
    homeServiceVerified: { type: Boolean, default: false },

    // booking for self or a family member / guest
    guestName: { type: String },
    familyMember: { type: mongoose.Schema.Types.ObjectId, ref: 'FamilyMember' },

    isWalkIn: { type: Boolean, default: false }, // added by salon offline
    tip: { type: Number, default: 0 },
    couponCode: { type: String },

    // pricing
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    total: { type: Number, required: true },
    commission: { type: Number, default: 0 }, // platform cut
    salonPayout: { type: Number, default: 0 },

    paymentMode: { type: String, enum: ['token', 'full_online', 'at_salon', 'wallet'], required: true },
    paymentStatus: { type: String, enum: ['unpaid', 'token_paid', 'paid', 'refunded'], default: 'unpaid' },
    amountPaid: { type: Number, default: 0 },
    amountDue: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'],
      default: 'pending',
      index: true,
    },
    // chat/call are unlocked between confirmation and completion
    communicationUnlocked: { type: Boolean, default: false },
    cancelledBy: { type: String, enum: ['customer', 'salon', 'system'] },
    cancelReason: { type: String },
    completedAt: { type: Date },
    ratedByCustomer: { type: Boolean, default: false },
    ratedBySalon: { type: Boolean, default: false }, // owner/staff rated the customer
    paidOut: { type: Boolean, default: false }, // salon payout settled
    reminderSent: { type: Boolean, default: false }, // 1-hour reminder sent
    glowPointsRedeemed: { type: Number, default: 0 }, // loyalty points used
    productsUsed: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }], // for post-service recommendations
  },
  { timestamps: true }
);

bookingSchema.index({ salon: 1, status: 1, date: 1 });
bookingSchema.index({ customer: 1, createdAt: -1 });

bookingSchema.pre('save', function (next) {
  if (!this.bookingCode) {
    const rand = Math.floor(1000 + Math.random() * 9000);
    this.bookingCode = `GW${Date.now().toString().slice(-6)}${rand}`;
  }
  next();
});

module.exports = mongoose.model('Booking', bookingSchema);
