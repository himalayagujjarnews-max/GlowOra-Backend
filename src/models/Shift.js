/**
 * Shift — a staff member's working hours for one day of the week at a salon.
 * One document per (salon, staff, dayOfWeek) — see the compound index below,
 * enforced practically via the upsert in shift.controller.js. `isOff` lets a
 * specific stylist be marked off on a day even if the salon itself is open
 * (the salon-wide day off is Salon.weeklyOff — this is the per-staff layer).
 */
const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema(
  {
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    staff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true, index: true },
    dayOfWeek: { type: Number, min: 0, max: 6, required: true }, // 0=Sun, matching Salon.weeklyOff
    startTime: { type: String }, // 'HH:mm'
    endTime: { type: String },   // 'HH:mm'
    isOff: { type: Boolean, default: false },
  },
  { timestamps: true }
);

shiftSchema.index({ salon: 1, staff: 1, dayOfWeek: 1 });

module.exports = mongoose.model('Shift', shiftSchema);
