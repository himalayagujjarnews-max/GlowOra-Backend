/**
 * ConsentLog — GDPR/DPDP consent capture with versioning.
 * Records what a user agreed to, when, and from where.
 */
const mongoose = require('mongoose');

const consentLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['terms', 'privacy', 'marketing', 'data_processing'], required: true },
    version: { type: String, required: true },
    granted: { type: Boolean, required: true },
    ip: { type: String },
    userAgent: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

consentLogSchema.index({ user: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model('ConsentLog', consentLogSchema);
