/**
 * LoginHistory — every login attempt (success or fail) for security review
 * and suspicious-login alerts.
 */
const mongoose = require('mongoose');

const loginHistorySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    phone: { type: String },
    method: { type: String, enum: ['otp', 'password', '2fa', 'refresh'], required: true },
    success: { type: Boolean, required: true },
    reason: { type: String }, // failure reason
    ip: { type: String },
    userAgent: { type: String },
    device: { type: String },
    location: { type: String },
    suspicious: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

loginHistorySchema.index({ user: 1, createdAt: -1 });
loginHistorySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 });

module.exports = mongoose.model('LoginHistory', loginHistorySchema);
