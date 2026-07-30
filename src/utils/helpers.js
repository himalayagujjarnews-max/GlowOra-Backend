/**
 * Small shared helpers.
 */
const config = require('../config/env');

/** Current date in the app's configured timezone, as 'YYYY-MM-DD'. */
function localYmd(offsetDays = 0, timezone = config.defaults.timezone) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  // en-CA gives ISO-style YYYY-MM-DD; timezone shifts to local calendar day
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Current time 'HH:mm' in the app timezone. */
function localTime(timezone = config.defaults.timezone) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  } catch {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

/** Add minutes to an 'HH:mm' string, returns 'HH:mm'. */
function addMinutes(time, mins) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Generate a short unique-ish code with a prefix. */
function genCode(prefix = 'GW') {
  return `${prefix}${Date.now().toString().slice(-6)}${Math.floor(1000 + Math.random() * 9000)}`;
}

/** 'YYYY-MM-DD' for today or an offset in days (timezone-aware). */
function ymd(offsetDays = 0) {
  return localYmd(offsetDays);
}

/** Clamp a number. */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/** Round to 2 decimals for money. */
function money(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Commission rate for a booking, per documentation.
 * Priority: salon subscription plan tier, then payment mode.
 *   Plans:   free 15% · basic 12% · pro 10%
 *   Modes:   at_salon 5% floor · token 5% on remaining + fixed token (handled in caller)
 * Returns a percentage number (e.g. 12).
 */
function commissionPercentFor(salon, paymentMode, defaults) {
  const planRates = { free: 15, basic: 12, pro: 10 };
  let rate = planRates[salon?.subscriptionPlan] ?? defaults.commissionPercent;
  // pay-at-salon: platform only takes a small cut (documented 5%)
  if (paymentMode === 'at_salon') rate = Math.min(rate, 5);
  return rate;
}

module.exports = { addMinutes, genCode, ymd, localYmd, localTime, clamp, money, commissionPercentFor };
