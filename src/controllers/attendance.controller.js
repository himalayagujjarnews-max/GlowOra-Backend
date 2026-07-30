/**
 * Attendance controller — mark and view staff attendance & staff earnings.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const StaffAttendance = require('../models/StaffAttendance');
const Staff = require('../models/Staff');
const Salon = require('../models/Salon');
const Booking = require('../models/Booking');
const mongoose = require('mongoose');
const { ymd } = require('../utils/helpers');

async function assertOwns(user, salonId) {
  const salon = await Salon.findById(salonId);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== user._id.toString() && user.role !== 'admin') {
    throw ApiError.forbidden('Not your salon');
  }
}

// POST /attendance   { staff, salon, date?, status, checkIn?, checkOut? }
exports.mark = asyncHandler(async (req, res) => {
  const { staff, salon, status } = req.body;
  if (!staff || !salon || !status) throw ApiError.badRequest('staff, salon and status are required');
  await assertOwns(req.user, salon);
  const date = req.body.date || ymd();
  const record = await StaffAttendance.findOneAndUpdate(
    { staff, date },
    { staff, salon, date, status, checkIn: req.body.checkIn, checkOut: req.body.checkOut, note: req.body.note },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  sendResponse(res, 200, 'Attendance marked', { attendance: record });
});

// GET /attendance?salon=&date=
exports.list = asyncHandler(async (req, res) => {
  const { salon, date } = req.query;
  if (!salon) throw ApiError.badRequest('salon query param required');
  await assertOwns(req.user, salon);
  const filter = { salon };
  if (date) filter.date = date;
  const records = await StaffAttendance.find(filter).populate('staff', 'name avatar').sort({ date: -1 });
  sendResponse(res, 200, 'Attendance', { records });
});

// GET /attendance/earnings?salon=&from=&to=   (staff earnings from completed bookings)
exports.earnings = asyncHandler(async (req, res) => {
  const { salon, from, to } = req.query;
  if (!salon) throw ApiError.badRequest('salon query param required');
  await assertOwns(req.user, salon);

  const match = { salon: new mongoose.Types.ObjectId(salon), status: 'completed' };
  if (from || to) {
    match.date = {};
    if (from) match.date.$gte = from;
    if (to) match.date.$lte = to;
  }
  const agg = await Booking.aggregate([
    { $match: match },
    { $group: { _id: '$staff', bookings: { $sum: 1 }, revenue: { $sum: '$total' }, earnings: { $sum: '$salonPayout' } } },
  ]);
  const staffMap = {};
  const staffList = await Staff.find({ salon }).select('name');
  staffList.forEach((s) => { staffMap[s._id] = s.name; });
  const result = agg.map((a) => ({ staff: a._id, name: staffMap[a._id] || 'Unknown', bookings: a.bookings, revenue: a.revenue, earnings: a.earnings }));
  sendResponse(res, 200, 'Staff earnings', { earnings: result });
});
