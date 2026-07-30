/**
 * Booking controller — availability, create, list, status transitions, cancel.
 * Commission and payout are computed at creation time.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const config = require('../config/env');
const Booking = require('../models/Booking');
const Service = require('../models/Service');
const Staff = require('../models/Staff');
const Salon = require('../models/Salon');
const Slot = require('../models/Slot');
const User = require('../models/User');
const FamilyMember = require('../models/FamilyMember');
const { notifyUser } = require('../services/notification.service');
const { evaluate: evaluateCoupon } = require('./coupon.controller');
const { debitWallet, creditWallet } = require('./wallet.controller');
const { localYmd, localTime, commissionPercentFor } = require('../utils/helpers');

// Simple slot generator between open/close in 30-min steps.
function buildSlots(openTime, closeTime, step = 30) {
  const [oh, om] = openTime.split(':').map(Number);
  const [ch, cm] = closeTime.split(':').map(Number);
  let cur = oh * 60 + om;
  const end = ch * 60 + cm;
  const out = [];
  while (cur + step <= end) {
    const sh = String(Math.floor(cur / 60)).padStart(2, '0');
    const sm = String(cur % 60).padStart(2, '0');
    out.push(`${sh}:${sm}`);
    cur += step;
  }
  return out;
}

// GET /api/v1/bookings/availability?salon=&staff=&date=
exports.getAvailability = asyncHandler(async (req, res) => {
  const { salon, staff, date } = req.query;
  if (!salon || !staff || !date) throw ApiError.badRequest('salon, staff and date are required');

  const salonDoc = await Salon.findById(salon);
  if (!salonDoc) throw ApiError.notFound('Salon not found');

  const all = buildSlots(salonDoc.openTime || '09:00', salonDoc.closeTime || '20:00');
  const taken = await Slot.find({ staff, date, status: { $in: ['booked', 'held'] } }).select('startTime');
  const takenSet = new Set(taken.map((s) => s.startTime));

  const slots = all.map((t) => ({ time: t, available: !takenSet.has(t) }));
  sendResponse(res, 200, 'Availability', { date, slots });
});

// POST /api/v1/bookings   (customer)
// paymentMode: 'token' | 'full_online' | 'at_salon' | 'wallet'
// Money is NOT marked paid here (except wallet & at_salon). Online/token
// payments are confirmed later via /payments/verify.
exports.create = asyncHandler(async (req, res) => {
  const { salon, serviceIds, date, startTime, mode = 'salon', address, paymentMode, couponCode, familyMemberId } = req.body;
  let { staff } = req.body;
  // staff is now OPTIONAL — customer may pick "Any stylist". Required: salon, services, date, time, payment.
  if (!salon || !serviceIds?.length || !date || !startTime || !paymentMode) {
    throw ApiError.badRequest('salon, serviceIds, date, startTime and paymentMode are required');
  }
  if (!['token', 'full_online', 'at_salon', 'wallet'].includes(paymentMode)) {
    throw ApiError.badRequest('Invalid payment mode');
  }
  if (mode === 'home' && !address) throw ApiError.badRequest('Address is required for home service');

  const salonDoc = await Salon.findById(salon);
  if (!salonDoc || salonDoc.status !== 'active') throw ApiError.notFound('Salon not available');

  // If no staff chosen, auto-assign the salon's first active stylist (so the
  // booking still routes to someone). If the salon has no staff, allow null.
  if (!staff) {
    const anyStaff = await Staff.findOne({ salon, active: true });
    staff = anyStaff ? anyStaff._id : null;
  }
  let staffDoc = null;
  if (staff) {
    staffDoc = await Staff.findById(staff);
    if (!staffDoc || staffDoc.salon.toString() !== salon) throw ApiError.badRequest('Invalid staff for this salon');
  }

  const services = await Service.find({ _id: { $in: serviceIds }, salon });
  if (!services.length) throw ApiError.badRequest('No valid services selected');

  // optional family member
  let familyMember, guestName;
  if (familyMemberId) {
    const fm = await FamilyMember.findOne({ _id: familyMemberId, user: req.user._id });
    if (!fm) throw ApiError.badRequest('Invalid family member');
    familyMember = fm._id; guestName = fm.name;
  }

  // pricing
  const subtotal = services.reduce((sum, s) => sum + (s.discountPrice || s.price), 0);
  const totalDuration = services.reduce((sum, s) => sum + s.durationMinutes, 0);

  // coupon (validated + consumed) — stacks before the online discount
  let discount = 0;
  let appliedCoupon;
  if (couponCode) {
    const { coupon, discount: couponDiscount } = await evaluateCoupon(couponCode, subtotal, req.user, salonDoc.address?.city);
    discount += couponDiscount;
    appliedCoupon = coupon;
  }
  if (paymentMode === 'full_online') discount += Math.round((subtotal - discount) * (config.onlineDiscountPercent / 100));

  // loyalty redemption — 10 Glow Points = ₹1 (config: loyaltyPointsPerRupee)
  let glowPointsRedeemed = 0;
  const redeemPoints = parseInt(req.body.redeemPoints, 10) || 0;
  if (redeemPoints > 0) {
    const available = req.user.glowPoints || 0;
    const usePoints = Math.min(redeemPoints, available);
    const redeemValue = Math.floor(usePoints * config.loyaltyPointsPerRupee); // points -> rupees
    const capped = Math.min(redeemValue, Math.max(0, subtotal - discount)); // can't exceed remaining
    if (capped > 0) {
      glowPointsRedeemed = Math.ceil(capped / config.loyaltyPointsPerRupee);
      discount += capped;
    }
  }

  const total = Math.max(0, subtotal - discount);
  // tiered commission (salon plan + payment mode) — documented model
  const commissionPct = commissionPercentFor(salonDoc, paymentMode, config);
  const commission = Math.round((total * commissionPct) / 100);
  const salonPayout = total - commission;

  // compute end time
  const [h, m] = startTime.split(':').map(Number);
  const startMin = h * 60 + m;
  const endMin = startMin + totalDuration;
  const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

  // overlap check — a booking's whole [start,end) window must be free for this staff
  const sameDay = await Slot.find({ staff, date, status: { $in: ['booked', 'held'] } }).select('startTime endTime');
  const toMin = (t) => { const [hh, mm] = t.split(':').map(Number); return hh * 60 + mm; };
  const clash = sameDay.some((s) => {
    const sS = toMin(s.startTime); const sE = toMin(s.endTime || s.startTime);
    return startMin < sE && endMin > sS; // intervals overlap
  });
  if (clash) throw ApiError.conflict('This stylist is already booked during that time. Please pick another slot.');

  // reserve slot (unique index guards against exact-time races)
  let slot;
  try {
    slot = await Slot.create({ salon, staff, date, startTime, endTime, status: 'booked' });
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('That time slot was just taken. Please pick another.');
    throw err;
  }

  // payment state — only wallet is charged now; token/full_online happen at /payments/verify
  let amountPaid = 0;
  let paymentStatus = 'unpaid';
  let status = 'pending';
  let communicationUnlocked = false;

  if (paymentMode === 'wallet') {
    try {
      await debitWallet(req.user._id, total, 'booking', `Booking payment`, undefined);
    } catch (err) {
      await Slot.findByIdAndDelete(slot._id); // release reserved slot
      throw err;
    }
    amountPaid = total; paymentStatus = 'paid'; status = 'confirmed'; communicationUnlocked = true;
  } else if (paymentMode === 'at_salon') {
    status = 'pending'; // salon must accept
  }
  // token & full_online remain unpaid+pending until payment verified

  const amountDue = total - amountPaid;

  const booking = await Booking.create({
    customer: req.user._id,
    salon, staff,
    services: services.map((s) => ({ service: s._id, name: s.name, price: s.discountPrice || s.price, durationMinutes: s.durationMinutes })),
    slot: slot._id,
    date, startTime,
    mode, address,
    familyMember, guestName,
    couponCode: appliedCoupon ? appliedCoupon.code : undefined,
    subtotal, discount, total, commission, salonPayout,
    glowPointsRedeemed,
    paymentMode, paymentStatus, amountPaid, amountDue,
    status, communicationUnlocked,
  });

  slot.booking = booking._id;
  await slot.save();
  await Salon.findByIdAndUpdate(salon, { $inc: { bookingCount: 1 } });

  // deduct redeemed loyalty points
  if (glowPointsRedeemed > 0) {
    await User.findByIdAndUpdate(req.user._id, { $inc: { glowPoints: -glowPointsRedeemed } });
  }

  // consume the coupon now that the booking exists
  if (appliedCoupon) {
    const existing = appliedCoupon.usedBy.find((u) => u.user.toString() === req.user._id.toString());
    if (existing) existing.count += 1; else appliedCoupon.usedBy.push({ user: req.user._id, count: 1 });
    appliedCoupon.usedCount += 1;
    await appliedCoupon.save();
  }

  // 3-way notification chain (customer + salon owner + assigned staff)
  notifyUser(req.user._id, {
    title: 'Booking placed 🎉',
    body: `Your booking ${booking.bookingCode} at ${salonDoc.name} is ${status === 'confirmed' ? 'confirmed' : 'awaiting confirmation'}.`,
    type: 'booking', data: { bookingId: booking._id.toString() },
  });
  notifyUser(salonDoc.owner, {
    title: 'New booking 🔔',
    body: `${guestName || 'A customer'} booked ${services.map((s) => s.name).join(', ')} for ${date} at ${startTime}.`,
    type: 'booking', data: { bookingId: booking._id.toString() },
  });
  if (staffDoc && staffDoc.user) {
    notifyUser(staffDoc.user, {
      title: 'You have a new booking 💇',
      body: `${services.map((s) => s.name).join(', ')} · ${date} ${startTime}`,
      type: 'booking', data: { bookingId: booking._id.toString() },
    });
  }

  sendResponse(res, 201, 'Booking created', { booking });
});

// GET /api/v1/bookings/mine?status=  (customer)
exports.getMine = asyncHandler(async (req, res) => {
  const filter = { customer: req.user._id };
  if (req.query.status) filter.status = req.query.status;
  const bookings = await Booking.find(filter)
    .populate('salon', 'name coverImage address')
    .populate('staff', 'name avatar')
    .sort({ createdAt: -1 });
  sendResponse(res, 200, 'Your bookings', { count: bookings.length, bookings });
});

// GET /api/v1/bookings/salon/:salonId?status=  (owner/staff)
exports.getForSalon = asyncHandler(async (req, res) => {
  const salon = await Salon.findById(req.params.salonId);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw ApiError.forbidden('Not your salon');
  }
  const filter = { salon: salon._id };
  if (req.query.status) filter.status = req.query.status;
  const bookings = await Booking.find(filter).populate('customer', 'name phone').populate('staff', 'name').sort({ date: 1, startTime: 1 });
  sendResponse(res, 200, 'Salon bookings', { count: bookings.length, bookings });
});

// GET /api/v1/bookings/staff-mine?status=&date=  (staff — only bookings assigned to them)
exports.getStaffMine = asyncHandler(async (req, res) => {
  // find the Staff record(s) linked to this user account
  const staffDocs = await Staff.find({ user: req.user._id }).select('_id');
  if (!staffDocs.length) return sendResponse(res, 200, 'Your bookings', { count: 0, bookings: [] });
  const staffIds = staffDocs.map((s) => s._id);

  const filter = { staff: { $in: staffIds } };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.date) filter.date = req.query.date;
  const bookings = await Booking.find(filter)
    .populate('customer', 'name phone')
    .populate('salon', 'name')
    .sort({ date: 1, startTime: 1 });
  sendResponse(res, 200, 'Your bookings', { count: bookings.length, bookings });
});

// PATCH /api/v1/bookings/:id/status  { status }  (owner/staff)
exports.updateStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const valid = ['confirmed', 'in_progress', 'completed', 'no_show'];
  if (!valid.includes(status)) throw ApiError.badRequest('Invalid status');

  const booking = await Booking.findById(req.params.id).populate('salon', 'owner');
  if (!booking) throw ApiError.notFound('Booking not found');

  const isOwner = booking.salon.owner.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'admin';
  // staff can update only their own assigned bookings
  let isAssignedStaff = false;
  if (!isOwner && !isAdmin && req.user.role === 'staff') {
    const staffDoc = await Staff.findOne({ _id: booking.staff, user: req.user._id }).select('_id');
    isAssignedStaff = Boolean(staffDoc);
  }
  if (!isOwner && !isAdmin && !isAssignedStaff) {
    throw ApiError.forbidden('Not your booking to update');
  }

  booking.status = status;
  if (status === 'confirmed') booking.communicationUnlocked = true;
  if (status === 'completed') {
    booking.completedAt = new Date();
    booking.communicationUnlocked = false; // lock chat/call after completion

    // record products the stylist used (for the smart buy-again nudge)
    if (Array.isArray(req.body.productsUsed) && req.body.productsUsed.length) {
      booking.productsUsed = req.body.productsUsed;
    }

    // award loyalty points
    const pts = Math.round(booking.total * config.loyaltyPointsPerRupee);
    if (pts > 0) await User.findByIdAndUpdate(booking.customer, { $inc: { glowPoints: pts } });
    notifyUser(booking.customer, {
      title: 'Hope you loved it! ✨',
      body: `Your booking ${booking.bookingCode} is complete. You earned ${pts} Glow Points.`,
      type: 'booking',
      data: { bookingId: booking._id.toString() },
    });

    // smart product recommendation — nudge to buy what was used on them
    if (booking.productsUsed?.length) {
      try {
        const Product = require('../models/Product');
        const products = await Product.find({ _id: { $in: booking.productsUsed }, active: true }).select('name price');
        if (products.length) {
          const names = products.map((p) => p.name).join(', ');
          notifyUser(booking.customer, {
            title: 'Loved the result? Take it home 🛍️',
            body: `The products used today are on GlowOra Shop: ${names}.`,
            type: 'promo',
            data: { productIds: booking.productsUsed.map((p) => p.toString()) },
          });
        }
      } catch { /* non-fatal */ }
    }
  }
  if (status === 'confirmed') {
    notifyUser(booking.customer, {
      title: 'Booking confirmed ✓',
      body: `Your appointment ${booking.bookingCode} is confirmed.`,
      type: 'booking',
      data: { bookingId: booking._id.toString() },
    });
  }
  await booking.save();
  sendResponse(res, 200, `Booking ${status}`, { booking });
});

// PATCH /bookings/:id/reschedule  { date, startTime }  (customer)
exports.reschedule = asyncHandler(async (req, res) => {
  const { date, startTime } = req.body;
  if (!date || !startTime) throw ApiError.badRequest('date and startTime are required');
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.customer.toString() !== req.user._id.toString()) throw ApiError.forbidden('Not your booking');
  if (!['pending', 'confirmed'].includes(booking.status)) {
    throw ApiError.badRequest('Only upcoming bookings can be rescheduled');
  }

  // free old slot
  await Slot.findByIdAndUpdate(booking.slot, { status: 'available', booking: null });

  const totalDuration = booking.services.reduce((s, x) => s + (x.durationMinutes || 0), 0);
  const [h, m] = startTime.split(':').map(Number);
  const endMin = h * 60 + m + totalDuration;
  const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

  let slot;
  try {
    slot = await Slot.create({ salon: booking.salon, staff: booking.staff, date, startTime, endTime, status: 'booked', booking: booking._id });
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('That time slot is taken. Please pick another.');
    throw err;
  }
  booking.slot = slot._id;
  booking.date = date;
  booking.startTime = startTime;
  await booking.save();
  sendResponse(res, 200, 'Booking rescheduled', { booking });
});

// PATCH /api/v1/bookings/:id/cancel  { reason }  (customer or owner)
exports.cancel = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id).populate('salon', 'owner');
  if (!booking) throw ApiError.notFound('Booking not found');

  const isCustomer = booking.customer.toString() === req.user._id.toString();
  const isOwner = booking.salon.owner.toString() === req.user._id.toString();
  if (!isCustomer && !isOwner && req.user.role !== 'admin') throw ApiError.forbidden('Not allowed');
  if (['completed', 'cancelled'].includes(booking.status)) {
    throw ApiError.badRequest(`Cannot cancel a ${booking.status} booking`);
  }

  booking.status = 'cancelled';
  booking.cancelledBy = isCustomer ? 'customer' : isOwner ? 'salon' : 'system';
  booking.cancelReason = req.body.reason;
  booking.communicationUnlocked = false;

  // --- Refund policy (per documentation) ---
  // Salon/admin cancels        -> 100% refund + 50 goodwill Glow Points
  // Customer > 4h before slot  -> 100% refund
  // Customer 1-4h before slot  -> 50% refund
  // Customer < 1h before slot  -> no refund (token/amount forfeited)
  let refundAmount = 0;
  let goodwillPoints = 0;
  if (booking.amountPaid > 0) {
    if (!isCustomer) {
      refundAmount = booking.amountPaid;
      goodwillPoints = 50;
    } else {
      const slotDateTime = new Date(`${booking.date}T${booking.startTime}:00`);
      const hoursLeft = (slotDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursLeft >= 4) refundAmount = booking.amountPaid;
      else if (hoursLeft >= 1) refundAmount = Math.round(booking.amountPaid * 0.5);
      else refundAmount = 0;
    }
  }

  if (refundAmount > 0) {
    await creditWallet(booking.customer, refundAmount, 'refund', `Refund for cancelled booking ${booking.bookingCode}`, booking._id);
    booking.paymentStatus = 'refunded';
  }
  if (goodwillPoints > 0) {
    await User.findByIdAndUpdate(booking.customer, { $inc: { glowPoints: goodwillPoints } });
  }
  await booking.save();

  // free the slot
  if (booking.slot) await Slot.findByIdAndUpdate(booking.slot, { status: 'available', booking: null });

  // notify anyone waitlisted for this salon+date that a slot opened
  try {
    const { notifyWaiters } = require('./waitlist.controller');
    await notifyWaiters(booking.salon, booking.date);
  } catch { /* non-fatal */ }

  // notify customer
  notifyUser(booking.customer, {
    title: 'Booking cancelled',
    body: `Booking ${booking.bookingCode} was cancelled.` +
      (refundAmount > 0 ? ` ₹${refundAmount} refunded to your wallet.` : '') +
      (goodwillPoints > 0 ? ` ${goodwillPoints} Glow Points added for the inconvenience.` : ''),
    type: 'booking', data: { bookingId: booking._id.toString() },
  });
  // notify salon owner (slot freed)
  const salonForNotify = await Salon.findById(booking.salon).select('owner');
  if (salonForNotify) {
    notifyUser(salonForNotify.owner, {
      title: 'Booking cancelled',
      body: `Booking ${booking.bookingCode} on ${booking.date} at ${booking.startTime} was cancelled — the slot is now free.`,
      type: 'booking', data: { bookingId: booking._id.toString() },
    });
  }

  sendResponse(res, 200, 'Booking cancelled', { booking, refundAmount });
});

// POST /bookings/walkin   { salon, staff, serviceIds, customerName?, startTime? }  (owner/staff)
// Records an offline/walk-in customer so earnings & slots stay accurate.
exports.walkIn = asyncHandler(async (req, res) => {
  const { salon, staff, serviceIds, customerName, startTime } = req.body;
  if (!salon || !staff || !serviceIds?.length) {
    throw ApiError.badRequest('salon, staff and serviceIds are required');
  }
  const salonDoc = await Salon.findById(salon);
  if (!salonDoc) throw ApiError.notFound('Salon not found');
  const isOwner = salonDoc.owner.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'admin';
  let isSalonStaff = false;
  if (!isOwner && !isAdmin && req.user.role === 'staff') {
    const staffDoc = await Staff.findOne({ salon, user: req.user._id }).select('_id');
    isSalonStaff = Boolean(staffDoc);
  }
  if (!isOwner && !isAdmin && !isSalonStaff) {
    throw ApiError.forbidden('Not allowed');
  }
  const services = await Service.find({ _id: { $in: serviceIds }, salon });
  if (!services.length) throw ApiError.badRequest('No valid services');

  const subtotal = services.reduce((s, x) => s + (x.discountPrice || x.price), 0);
  const commission = Math.round((subtotal * config.commissionPercent) / 100);
  const date = localYmd();
  const time = startTime || localTime();

  const booking = await Booking.create({
    customer: req.user._id, // recorded under the salon account for walk-ins
    salon, staff,
    services: services.map((s) => ({ service: s._id, name: s.name, price: s.discountPrice || s.price, durationMinutes: s.durationMinutes })),
    slot: null,
    date, startTime: time,
    mode: 'salon',
    subtotal, discount: 0, total: subtotal, commission, salonPayout: subtotal - commission,
    paymentMode: 'at_salon', amountPaid: subtotal, amountDue: 0,
    status: 'completed', completedAt: new Date(),
    isWalkIn: true, guestName: customerName || 'Walk-in',
  });
  await Salon.findByIdAndUpdate(salon, { $inc: { bookingCount: 1 } });
  sendResponse(res, 201, 'Walk-in recorded', { booking });
});


// POST /bookings/:id/home-otp   (customer) — generate arrival OTP for home service
exports.generateHomeOtp = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id).select('+homeServiceOtp');
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.customer.toString() !== req.user._id.toString()) throw ApiError.forbidden('Not your booking');
  if (booking.mode !== 'home') throw ApiError.badRequest('OTP is only for home-service bookings');
  const otp = String(Math.floor(1000 + Math.random() * 9000));
  booking.homeServiceOtp = otp;
  await booking.save();
  sendResponse(res, 200, 'Share this OTP with the stylist on arrival', { otp });
});

// POST /bookings/:id/verify-home-otp   { otp }  (owner/staff) — confirm arrival
exports.verifyHomeOtp = asyncHandler(async (req, res) => {
  const booking = await Booking.findById(req.params.id).select('+homeServiceOtp').populate('salon', 'owner');
  if (!booking) throw ApiError.notFound('Booking not found');
  const isOwner = booking.salon.owner.toString() === req.user._id.toString();
  const isAdmin = req.user.role === 'admin';
  let isSalonStaff = false;
  if (!isOwner && !isAdmin && req.user.role === 'staff') {
    const staffDoc = await Staff.findOne({ salon: booking.salon._id, user: req.user._id }).select('_id');
    isSalonStaff = Boolean(staffDoc);
  }
  if (!isOwner && !isAdmin && !isSalonStaff) {
    throw ApiError.forbidden('Not allowed');
  }
  if (booking.homeServiceOtp !== req.body.otp) throw ApiError.badRequest('Incorrect OTP');
  booking.homeServiceVerified = true;
  booking.status = 'in_progress';
  await booking.save();
  sendResponse(res, 200, 'Arrival verified — service started', { booking });
});

// POST /bookings/:id/tip   { amount }  (customer) — add a tip after completion
exports.addTip = asyncHandler(async (req, res) => {
  const amount = parseInt(req.body.amount, 10);
  if (!amount || amount < 1) throw ApiError.badRequest('Enter a valid tip amount');
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.customer.toString() !== req.user._id.toString()) throw ApiError.forbidden('Not your booking');
  if (booking.status !== 'completed') throw ApiError.badRequest('You can tip after the service is completed');
  booking.tip = (booking.tip || 0) + amount;
  await booking.save();
  sendResponse(res, 200, 'Tip added — thank you!', { tip: booking.tip });
});
