/**
 * Subscription — an active subscription instance (a salon on Pro, or a
 * customer holding a Glow Pass).
 */
const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    audience: { type: String, enum: ['salon', 'customer'], required: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true },
    planKey: { type: String },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },   // customer pass
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon' }, // salon plan
    price: { type: Number, required: true },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, required: true },
    status: { type: String, enum: ['active', 'expired', 'cancelled'], default: 'active', index: true },
    autoRenew: { type: Boolean, default: false },
    servicesUsed: { type: Number, default: 0 }, // for customer pass
    razorpayPaymentId: { type: String },
  },
  { timestamps: true }
);

subscriptionSchema.index({ salon: 1, status: 1 });
subscriptionSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
