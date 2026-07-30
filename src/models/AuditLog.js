/**
 * AuditLog — immutable record of every sensitive/mutating action.
 * Never updated or deleted (compliance + forensics).
 */
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    actorRole: { type: String },
    action: { type: String, required: true, index: true }, // e.g. 'booking.cancel'
    method: { type: String },
    path: { type: String },
    targetType: { type: String },   // 'Booking' | 'Salon' ...
    targetId: { type: String },
    statusCode: { type: Number },
    ip: { type: String },
    userAgent: { type: String },
    requestId: { type: String, index: true },
    meta: { type: mongoose.Schema.Types.Mixed }, // redacted request summary
    success: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });
// retain audit logs for 2 years then auto-expire
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 730 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
