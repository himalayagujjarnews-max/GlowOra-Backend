/**
 * Campaign — a salon's marketing blast to a customer segment
 * (e.g. win back customers who haven't visited in 60 days).
 */
const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema(
  {
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    name: { type: String, required: true },
    segment: {
      type: String,
      enum: ['all_customers', 'inactive', 'new', 'high_value', 'birthday'],
      default: 'all_customers',
    },
    inactiveDays: { type: Number, default: 60 }, // for 'inactive' segment
    title: { type: String, required: true },
    message: { type: String, required: true },
    couponCode: { type: String },
    status: { type: String, enum: ['draft', 'sent'], default: 'draft', index: true },
    recipientsCount: { type: Number, default: 0 },
    sentAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Campaign', campaignSchema);
