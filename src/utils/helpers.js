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

/**
 * Convert an 'HH:mm' string to minutes-since-midnight, for correct
 * chronological comparisons. Plain string comparison ('9:00' >= '17:00')
 * is WRONG for non-zero-padded input — lexically '9' > '1', so a perfectly
 * valid "9:00 to 17:00" range incorrectly evaluates as start >= end. Always
 * use this instead of comparing HH:mm strings directly.
 */
function timeToMinutes(time) {
  const [h, m] = String(time).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Validate a 'YYYY-MM-DD' string is both correctly shaped AND a real
 * calendar date. A regex like /^\d{4}-\d{2}-\d{2}$/ only checks digit
 * placement — it happily accepts "2025-13-45" or "2025-02-30" — which then
 * silently produces an Invalid Date wherever the string later gets parsed
 * (or, worse, gets stored as-is and just never matches anything, leaving an
 * unreachable/orphaned record). This also rejects auto-rolled dates like
 * "2025-02-30" -> March instead of catching the mistake.
 */
function isValidYmd(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(str || ''))) return false;
  const [y, m, d] = str.split('-').map(Number);
  if (m < 1 || m > 12) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
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
 * Escape regex metacharacters in user-supplied search input before building
 * a `new RegExp(...)` from it. Without this, several public/admin search
 * endpoints (salon name/city search, admin user search, audit log search)
 * pass raw query strings straight into RegExp — a crafted pathological
 * pattern can trigger catastrophic backtracking (ReDoS) and hang the Mongo
 * query executor, and on the PUBLIC unauthenticated salon search endpoint
 * that's exploitable by anyone.
 */
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

module.exports = { addMinutes, timeToMinutes, isValidYmd, genCode, ymd, localYmd, localTime, clamp, money, commissionPercentFor, escapeRegex };
