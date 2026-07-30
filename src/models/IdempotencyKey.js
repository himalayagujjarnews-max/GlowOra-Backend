/**
 * IdempotencyKey — guarantees a client can safely retry a request (e.g. a
 * payment or order) without creating duplicates. The first response is
 * cached and replayed for identical retries.
 */
const mongoose = require('mongoose');

const idempotencyKeySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    method: { type: String },
    path: { type: String },
    requestHash: { type: String }, // guards against key reuse with different body
    statusCode: { type: Number },
    response: { type: mongoose.Schema.Types.Mixed },
    status: { type: String, enum: ['processing', 'completed'], default: 'processing' },
  },
  { timestamps: true }
);

// keys expire after 24h
idempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

module.exports = mongoose.model('IdempotencyKey', idempotencyKeySchema);
