/**
 * SupportTicket — help & complaints raised by customers or salons.
 */
const mongoose = require('mongoose');

const messageSub = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    fromSupport: { type: Boolean, default: false },
    text: { type: String, required: true },
  },
  { timestamps: true }
);

const ticketSchema = new mongoose.Schema(
  {
    ticketCode: { type: String, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subject: { type: String, required: true },
    category: { type: String, enum: ['booking', 'payment', 'account', 'salon', 'other'], default: 'other' },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    status: { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open', index: true },
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    messages: [messageSub],
  },
  { timestamps: true }
);

ticketSchema.pre('save', function (next) {
  if (!this.ticketCode) this.ticketCode = `TKT${Date.now().toString().slice(-8)}`;
  next();
});

module.exports = mongoose.model('SupportTicket', ticketSchema);
