/**
 * Notification — in-app notification feed item (also mirrors push sends).
 */
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, // null = broadcast
    title: { type: String, required: true },
    body: { type: String, required: true },
    type: {
      type: String,
      enum: ['booking', 'payment', 'promo', 'chat', 'system', 'review'],
      default: 'system',
    },
    data: { type: mongoose.Schema.Types.Mixed }, // deep-link payload
    image: { type: String },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
