/**
 * Scheduler — background jobs via node-cron. Started from server.js.
 *
 * Jobs:
 *  1. Appointment reminders    — every 5 min: notify customer + staff ~1h before slot
 *  2. Recurring bookings       — hourly: materialise due RecurringBooking into real bookings
 *  3. Expiry sweep             — daily: expire subscriptions, un-feature salons, expire waitlist
 *
 * All jobs are defensive (try/catch, skip-if-already-done flags) so a failure
 * in one run never crashes the server or double-fires.
 */
const cron = require('node-cron');
const logger = require('../utils/logger');
const { localYmd } = require('../utils/helpers');
const { notifyUser } = require('./notification.service');

const Booking = require('../models/Booking');
const RecurringBooking = require('../models/RecurringBooking');
const Slot = require('../models/Slot');
const Service = require('../models/Service');
const Staff = require('../models/Staff');
const Salon = require('../models/Salon');
const Subscription = require('../models/Subscription');
const Waitlist = require('../models/Waitlist');
const config = require('../config/env');

/* ---------- 1. Appointment reminders (every 5 minutes) ---------- */
async function sendReminders() {
  const now = new Date();
  const in1h = new Date(now.getTime() + 60 * 60 * 1000);
  const today = localYmd();

  // upcoming, confirmed, not yet reminded
  const bookings = await Booking.find({
    status: { $in: ['confirmed', 'pending'] },
    reminderSent: false,
    date: today,
  }).populate('salon', 'name owner').limit(200);

  for (const b of bookings) {
    // build the slot datetime in server local time
    const slotTime = new Date(`${b.date}T${b.startTime}:00`);
    if (slotTime > now && slotTime <= in1h) {
      notifyUser(b.customer, {
        title: 'Appointment reminder ⏰',
        body: `Your booking ${b.bookingCode} at ${b.salon?.name || 'the salon'} is at ${b.startTime}. See you soon!`,
        type: 'booking', data: { bookingId: b._id.toString() },
      });
      // notify assigned staff (their user account) if linked
      const staff = await Staff.findById(b.staff).select('user name');
      if (staff?.user) {
        notifyUser(staff.user, {
          title: 'Upcoming appointment 💇',
          body: `${b.startTime} — ${b.guestName || 'a customer'} for ${b.services.map((s) => s.name).join(', ')}`,
          type: 'booking', data: { bookingId: b._id.toString() },
        });
      }
      b.reminderSent = true;
      await b.save();
    }
  }
}

/* ---------- 2. Recurring bookings (hourly) ---------- */
function addFrequency(ymdStr, frequency) {
  const d = new Date(`${ymdStr}T00:00:00`);
  if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else if (frequency === 'biweekly') d.setDate(d.getDate() + 14);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

async function runRecurring() {
  const today = localYmd();
  const due = await RecurringBooking.find({ active: true, nextRunDate: { $lte: today } }).limit(100);

  for (const rec of due) {
    try {
      const [salon, staff, services] = await Promise.all([
        Salon.findById(rec.salon),
        Staff.findById(rec.staff),
        Service.find({ _id: { $in: rec.serviceIds }, salon: rec.salon }),
      ]);
      if (!salon || salon.status !== 'active' || !staff || !services.length) {
        rec.nextRunDate = addFrequency(rec.nextRunDate, rec.frequency);
        await rec.save();
        continue;
      }

      const subtotal = services.reduce((s, x) => s + (x.discountPrice || x.price), 0);
      const totalDuration = services.reduce((s, x) => s + x.durationMinutes, 0);
      const commission = Math.round((subtotal * config.commissionPercent) / 100);
      const [h, m] = rec.preferredTime.split(':').map(Number);
      const endMin = h * 60 + m + totalDuration;
      const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

      let slot;
      try {
        slot = await Slot.create({ salon: rec.salon, staff: rec.staff, date: rec.nextRunDate, startTime: rec.preferredTime, endTime, status: 'booked' });
      } catch (err) {
        // slot taken — skip this cycle, try next
        rec.nextRunDate = addFrequency(rec.nextRunDate, rec.frequency);
        await rec.save();
        continue;
      }

      const booking = await Booking.create({
        customer: rec.customer, salon: rec.salon, staff: rec.staff,
        services: services.map((s) => ({ service: s._id, name: s.name, price: s.discountPrice || s.price, durationMinutes: s.durationMinutes })),
        slot: slot._id, date: rec.nextRunDate, startTime: rec.preferredTime,
        subtotal, discount: 0, total: subtotal, commission, salonPayout: subtotal - commission,
        paymentMode: rec.paymentMode, paymentStatus: 'unpaid', amountDue: subtotal,
        status: 'pending',
      });
      slot.booking = booking._id;
      await slot.save();

      rec.lastBookingId = booking._id;
      rec.nextRunDate = addFrequency(rec.nextRunDate, rec.frequency);
      await rec.save();

      notifyUser(rec.customer, {
        title: 'Your recurring appointment is booked 🔁',
        body: `${services.map((s) => s.name).join(', ')} on ${booking.date} at ${booking.startTime}.`,
        type: 'booking', data: { bookingId: booking._id.toString() },
      });
    } catch (err) {
      logger.error(`recurring run failed for ${rec._id}: ${err.message}`);
    }
  }
}

/* ---------- 3. Daily expiry sweep ---------- */
async function expirySweep() {
  const now = new Date();
  // expire subscriptions
  await Subscription.updateMany({ status: 'active', endDate: { $lt: now } }, { status: 'expired' });
  // salon subscription downgrade to free when expired
  await Salon.updateMany({ subscriptionExpiry: { $lt: now }, subscriptionPlan: { $ne: 'free' } },
    { subscriptionPlan: 'free', subscriptionExpiry: null });
  // un-feature expired featured salons
  await Salon.updateMany({ isFeatured: true, featuredExpiry: { $lt: now } }, { isFeatured: false });
  // expire old waitlist entries (older than 2 days past their date)
  const cutoff = localYmd(-2);
  await Waitlist.updateMany({ status: { $in: ['waiting', 'notified'] }, date: { $lt: cutoff } }, { status: 'expired' });
}

function start() {
  // every 5 minutes
  cron.schedule('*/5 * * * *', () => sendReminders().catch((e) => logger.error(`reminders: ${e.message}`)));
  // hourly at minute 0
  cron.schedule('0 * * * *', () => runRecurring().catch((e) => logger.error(`recurring: ${e.message}`)));
  // daily at 02:00
  cron.schedule('0 2 * * *', () => expirySweep().catch((e) => logger.error(`expiry: ${e.message}`)));
  logger.info('⏰ Scheduler started (reminders/5m · recurring/1h · expiry/daily)');
}

module.exports = { start, sendReminders, runRecurring, expirySweep };
