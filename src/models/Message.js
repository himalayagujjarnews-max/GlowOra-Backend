/**
 * Message — a single chat message within a Conversation.
 */
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, enum: ['customer', 'staff', 'owner'], required: true },
    text: { type: String, maxlength: 2000 },
    attachment: { type: String }, // image url
    type: { type: String, enum: ['text', 'image', 'system'], default: 'text' },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

messageSchema.index({ conversation: 1, createdAt: 1 });

module.exports = mongoose.model('Message', messageSchema);
