/**
 * Session — one active login (device). Enables "log out everywhere",
 * per-device revocation, and refresh-token reuse detection.
 *
 * The refresh token is never stored in plaintext — only its SHA-256 hash.
 * `tokenFamily` groups rotated tokens so reuse of an old token can revoke
 * the whole family (classic refresh-token-rotation defence).
 */
const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, index: true },
    tokenFamily: { type: String, required: true, index: true },
    device: { type: String },        // "iPhone 14 · iOS 17"
    userAgent: { type: String },
    ip: { type: String },
    location: { type: String },      // coarse city/country if resolved
    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    revoked: { type: Boolean, default: false },
    revokedReason: { type: String },
  },
  { timestamps: true }
);

sessionSchema.index({ user: 1, revoked: 1 });
// TTL cleanup of long-expired sessions
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

module.exports = mongoose.model('Session', sessionSchema);
