/**
 * StaffBlockout — a specific date/time range where a staff member is
 * unavailable (e.g. lunch break, personal appointment, holiday).
 * This is the per-date override layer on top of the weekly Shift roster.
 * When the booking availability check runs, it excludes slots that fall
 * within any blockout period for the requested staff+date.
 */
const mongoose = require('mongoose');

const blockoutSchema = new mongoose.Schema(
  {
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    staff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true, index: true },
    date: { type: String, required: true }, // 'YYYY-MM-DD'
    // startTime/endTime are optional — null means "all day off on this date"
    startTime: { type: String, default: null }, // 'HH:mm'
    endTime: { type: String, default: null },   // 'HH:mm'
    reason: { type: String, default: '' },
    // Owner-created blockouts (the original use-case) are effective
    // immediately — 'approved' by default. Staff can also self-request a
    // blockout (see blockout.controller.js requestLeave), which starts as
    // 'pending' and does NOT block availability until the owner approves it.
    status: { type: String, enum: ['approved', 'pending', 'rejected'], default: 'approved', index: true },
  },
  { timestamps: true }
);

blockoutSchema.index({ salon: 1, staff: 1, date: 1 });

module.exports = mongoose.model('StaffBlockout', blockoutSchema);
