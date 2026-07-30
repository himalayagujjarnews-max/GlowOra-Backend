/**
 * StaffAttendance — daily present/absent/leave record per staff.
 */
const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
  {
    staff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true, index: true },
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    date: { type: String, required: true }, // 'YYYY-MM-DD'
    status: { type: String, enum: ['present', 'absent', 'leave', 'half_day'], default: 'present' },
    checkIn: { type: String },
    checkOut: { type: String },
    note: { type: String },
  },
  { timestamps: true }
);

attendanceSchema.index({ staff: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('StaffAttendance', attendanceSchema);
