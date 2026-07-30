/**
 * SubscriptionPlan — the tiers a salon can subscribe to (Free/Basic/Pro),
 * and customer passes. `audience` distinguishes them.
 */
const mongoose = require('mongoose');

const subscriptionPlanSchema = new mongoose.Schema(
  {
    audience: { type: String, enum: ['salon', 'customer'], required: true, index: true },
    key: { type: String, required: true, unique: true }, // 'free' | 'basic' | 'pro' | 'glow_pass'
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    billingCycle: { type: String, enum: ['monthly', 'yearly'], default: 'monthly' },
    commissionPercent: { type: Number }, // for salon plans
    features: [{ type: String }],
    maxServices: { type: Number, default: 0 }, // 0 = unlimited
    includedServices: { type: Number, default: 0 }, // for customer pass
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
