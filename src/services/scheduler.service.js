/**
 * Scheduler — background jobs via node-cron. Started from server.js.
 *
 * Jobs:
 *  1. Appointment reminders    — every 5 min: notify customer + staff ~1h before slot
 *  2. Recurring bookings       — hourly: materialise due RecurringBooking into real bookings
 *  3. Expiry sweep             — daily: expire subscriptions, un-feature salons, expire waitlist
 *  4. Birthday offers          — daily: notify customers whose birthday is today with a discount code
 *  5. Abandoned cart reminders — every 10 min: nudge customers who left the booking screen without booking
 *  6. Wallet settlement (T+1) — daily: sweep salon/staff wallet balances to their verified bank account
 *
 * All jobs are defensive (try/catch, skip-if-already-done flags) so a failure
 * in one run never crashes the server or double-fires.
 */
const cron = require('node-cron');
const logger = require('../utils/logger');
const { localYmd, commissionPercentFor } = require('../utils/helpers');
const { notifyUser } = require('./notification.service');

const Booking = require('../models/Booking');
const RecurringBooking = require('../models/RecurringBooking');
const Slot = require('../models/Slot');
const Service = require('../models/Service');
const Staff = require('../models/Staff');
const Salon = require('../models/Salon');
const Subscription = require('../models/Subscription');
const Waitlist = require('../models/Waitlist');
const Coupon = require('../models/Coupon');
const User = require('../models/User');
const AbandonedCart = require('../models/AbandonedCart');
const Payout = require('../models/Payout');
const { debitSalonWallet, debitStaffWallet } = require('../controllers/partnerWallet.controller');
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
      // Tier/payment-mode-aware rate, matching the manual booking flow
      // (booking.controller.js) instead of a flat platform-wide rate — a
      // flat rate here silently overpaid/underpaid salons depending on their
      // subscription tier and this booking's payment mode.
      const commissionPct = commissionPercentFor(salon, rec.paymentMode, config);
      const commission = Math.round((subtotal * commissionPct) / 100);
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

/* ---------- 4. Birthday offers (daily) ---------- */
// SIMPLIFICATION: rather than minting a unique single-use coupon per customer
// (Coupon has no per-user code generator), we reuse one platform-wide
// 'BDAY20' code. Coupon.perUserLimit (default 1) already stops any one
// customer redeeming it more than once, so this is safe to share — it just
// isn't a distinct code per birthday. Documented per the task's own
// allowance to fall back to a pre-existing/shared code when dynamic
// per-user generation is out of scope.
async function ensureBirthdayCoupon() {
  const farFuture = new Date('2099-12-31');
  await Coupon.findOneAndUpdate(
    { code: 'BDAY20' },
    {
      $setOnInsert: {
        code: 'BDAY20',
        description: 'Happy Birthday! 20% off your next booking.',
        discountType: 'percent',
        discountValue: 20,
        maxDiscount: 300,
        perUserLimit: 1,
        validFrom: new Date(),
        validUntil: farFuture,
        active: true,
      },
    },
    { upsert: true }
  );
}

async function runBirthdayOffers() {
  await ensureBirthdayCoupon();

  const now = new Date();
  const month = now.getMonth(); // 0-11
  const day = now.getDate();

  // dob varies in birth YEAR, so we can't query month/day directly in Mongo —
  // pull everyone with a dob set and filter in JS. Customer base is small
  // enough for this app's scale; revisit with an aggregation $month/$dayOfMonth
  // match if the User collection grows large.
  const users = await User.find({ dob: { $exists: true, $ne: null } }).select('_id dob');
  for (const user of users) {
    const dob = new Date(user.dob);
    if (dob.getMonth() === month && dob.getDate() === day) {
      notifyUser(user._id, {
        title: '🎂 Happy Birthday from GlowOra!',
        body: 'Enjoy 20% off your next booking today — use code BDAY20',
        type: 'promo',
      });
    }
  }
}

/* ---------- 5. Abandoned cart reminders (every 10 minutes) ---------- */
// Booking.js fires POST /bookings/abandoned-cart once per screen visit when
// services are selected. This job finds carts idle 20+ minutes that haven't
// been reminded yet and nudges the customer once, then flags `reminded` so
// it never fires twice for the same cart. If the booking actually went
// through, booking.controller.js's create() already deleted the cart doc —
// so anything still sitting here genuinely wasn't completed.
async function runAbandonedCartReminders() {
  const cutoff = new Date(Date.now() - 20 * 60 * 1000);
  const carts = await AbandonedCart.find({
    reminded: false,
    updatedAt: { $lte: cutoff },
  }).populate('salon', 'name').limit(200);

  for (const cart of carts) {
    try {
      if (!cart.salon) { cart.reminded = true; await cart.save(); continue; } // salon deleted/inactive — skip
      notifyUser(cart.user, {
        title: 'Still shopping? 👀',
        body: `You left something in your cart — complete your booking at ${cart.salon.name}!`,
        type: 'booking',
        data: { salonId: cart.salon._id.toString() },
      });
      cart.reminded = true;
      await cart.save();
    } catch (err) {
      logger.error(`abandonedCartReminders failed for ${cart._id}: ${err.message}`);
    }
  }
}

/* ---------- 6. Wallet -> bank settlement (daily, T+1) ---------- */
// Sweeps every salon/staff wallet that has money AND a bank account the
// admin has manually verified (bankVerified), debits the wallet, and files
// a Payout record for it. There's no real bank-transfer API wired up yet
// (e.g. RazorpayX Payouts) — following the same "hook now, integrate later"
// convention as config/razorpay.js's enabled/mock fallback, this job still
// does the automated PART the admin explicitly asked NOT to do manually
// (computing who's owed what, per booking) and leaves only the actual bank
// wire as a 'processing' record for admin to confirm once the money has
// actually moved. Swapping in a real payout API later just means flipping
// this to call it before marking `status: 'paid'` instead of 'processing'.
const MIN_SETTLEMENT_AMOUNT = 1; // skip paise-level dust, not worth a payout record

async function runWalletSettlement() {
  const salons = await Salon.find({ walletBalance: { $gte: MIN_SETTLEMENT_AMOUNT }, bankVerified: true })
    .select('_id walletBalance owner name');
  for (const salon of salons) {
    try {
      const amount = salon.walletBalance;
      const newBalance = await debitSalonWallet(salon._id, amount, 'payout', 'Automated T+1 settlement to bank account', null);
      if (newBalance === null) continue; // balance changed between read and debit — skip, next run picks it up
      const payout = await Payout.create({
        recipientType: 'salon', salon: salon._id, amount,
        status: 'processing', source: 'wallet_settlement', method: 'bank',
        notes: 'Automated T+1 settlement — awaiting bank transfer confirmation',
      });
      notifyUser(salon.owner, {
        title: 'Payout on the way 💸',
        body: `₹${amount} from your wallet is being transferred to your bank account.`,
        type: 'system', data: { payoutId: payout._id.toString() },
      });
    } catch (err) {
      logger.error(`walletSettlement (salon ${salon._id}) failed: ${err.message}`);
    }
  }

  const staffMembers = await Staff.find({ walletBalance: { $gte: MIN_SETTLEMENT_AMOUNT }, bankVerified: true })
    .select('_id walletBalance user name');
  for (const staff of staffMembers) {
    try {
      const amount = staff.walletBalance;
      const newBalance = await debitStaffWallet(staff._id, amount, 'payout', 'Automated T+1 settlement to bank account', null);
      if (newBalance === null) continue;
      const payout = await Payout.create({
        recipientType: 'staff', staff: staff._id, amount,
        status: 'processing', source: 'wallet_settlement', method: 'bank',
        notes: 'Automated T+1 settlement — awaiting bank transfer confirmation',
      });
      if (staff.user) {
        notifyUser(staff.user, {
          title: 'Payout on the way 💸',
          body: `₹${amount} from your wallet is being transferred to your bank account.`,
          type: 'system', data: { payoutId: payout._id.toString() },
        });
      }
    } catch (err) {
      logger.error(`walletSettlement (staff ${staff._id}) failed: ${err.message}`);
    }
  }
}

function start() {
  // every 5 minutes
  cron.schedule('*/5 * * * *', () => sendReminders().catch((e) => logger.error(`reminders: ${e.message}`)));
  // hourly at minute 0
  cron.schedule('0 * * * *', () => runRecurring().catch((e) => logger.error(`recurring: ${e.message}`)));
  // daily at 02:00
  cron.schedule('0 2 * * *', () => expirySweep().catch((e) => logger.error(`expiry: ${e.message}`)));
  // daily at 09:00 — a friendlier hour to wish someone happy birthday than 2am
  cron.schedule('0 9 * * *', () => runBirthdayOffers().catch((e) => logger.error(`birthdayOffers: ${e.message}`)));
  // every 10 minutes
  cron.schedule('*/10 * * * *', () => runAbandonedCartReminders().catch((e) => logger.error(`abandonedCartReminders: ${e.message}`)));
  // daily at 03:30 — after the 02:00 expiry sweep, gives yesterday's completed
  // bookings time to have credited wallets before settling them.
  cron.schedule('30 3 * * *', () => runWalletSettlement().catch((e) => logger.error(`walletSettlement: ${e.message}`)));
  logger.info('⏰ Scheduler started (reminders/5m · recurring/1h · expiry/daily · birthdayOffers/daily · abandonedCartReminders/10m · walletSettlement/daily)');
}

module.exports = { start, sendReminders, runRecurring, expirySweep, runBirthdayOffers, runAbandonedCartReminders, runWalletSettlement };
