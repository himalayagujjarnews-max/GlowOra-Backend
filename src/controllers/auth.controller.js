/**
 * Auth controller — OTP login for customers/owners, password login for
 * owners/admins, token refresh with rotation, logout, FCM registration,
 * and password reset. Includes account lockout on repeated failures.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const { generateOtp, saveOtp, sendSms, verifyOtp, isOnCooldown, twilioEnabled } = require('../utils/otp');
const { sendEmailOtp } = require('../utils/email');
const { hashPassword, comparePassword, isStrong } = require('../utils/password');
const { decrypt, sha256 } = require('../utils/encryption');
const totp = require('../utils/totp');
const sessionService = require('../services/session.service');
const User = require('../models/User');
const LoginHistory = require('../models/LoginHistory');
const config = require('../config/env');
const { notifyUser } = require('../services/notification.service');
const { admin: firebaseAdmin, enabled: firebaseEnabled } = require('../config/firebase');
const { OAuth2Client } = require('google-auth-library');
const appleSignin = require('apple-signin-auth');

const googleClient = config.googleClientIds.length ? new OAuth2Client() : null;

function publicUser(u) {
  return {
    id: u._id, name: u.name, phone: u.phone, email: u.email, role: u.role, roles: u.roles,
    avatar: u.avatar, city: u.city, walletBalance: u.walletBalance,
    glowPoints: u.glowPoints, referralCode: u.referralCode,
    gender: u.gender, dob: u.dob, emailVerified: u.emailVerified,
    hasPassword: Boolean(u.password),
    twoFactorEnabled: u.twoFactorEnabled,
    notificationsEnabled: u.notificationsEnabled,
    notificationPrefs: u.notificationPrefs,
    // Loyalty tier — computed from lifetime spend, never stored directly, so
    // the frontend always gets an up-to-date tier without a separate call.
    totalSpent: u.totalSpent || 0,
    loyaltyTier: User.getTier(u.totalSpent || 0),
    identityVerification: u.identityVerification,
  };
}

function reqCtx(req) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

/**
 * One identity (phone / email / Google account) can hold several roles at
 * once — e.g. the same person can be a customer AND a salon owner. `role` is
 * whichever one is "active" for the app you just logged into; `roles` is the
 * full set this identity has ever unlocked.
 *
 * - 'customer' is always available to anyone (no gatekeeping).
 * - 'owner' can be self-granted the first time someone logs into the partner
 *   app with role='owner' — this is the "become a partner" flow.
 * - 'staff' and 'admin' are NEVER self-granted here — those can only be
 *   added by an owner (staff) or seeded/promoted directly (admin). If the
 *   requested role isn't already unlocked, `role` is left untouched, and the
 *   caller's existing "not a partner" guard correctly blocks the login.
 *
 * Mutates `user.role`/`user.roles` in place; caller is responsible for saving.
 */
function resolveLoginRole(user, requestedRole) {
  if (!requestedRole || !['customer', 'owner', 'staff', 'admin'].includes(requestedRole)) return;
  if (!user.roles || !user.roles.length) user.roles = [user.role];

  if (user.roles.includes(requestedRole)) {
    user.role = requestedRole; // already unlocked — just switch active context
    return;
  }
  if (requestedRole === 'customer' || requestedRole === 'owner') {
    user.roles.push(requestedRole); // self-service unlock
    user.role = requestedRole;
  }
  // 'staff' / 'admin': not unlocked and not self-grantable — role stays as-is.
}

/** Fired once, right after a brand-new account is created (any login method). */
function sendWelcomeNotification(user) {
  notifyUser(user._id, {
    title: `Welcome to GlowOra, ${user.name || 'there'}! ✨`,
    body: 'Discover top-rated salons near you and book your first appointment in seconds.',
    type: 'system',
  });
}

async function logLogin(user, method, success, req, reason) {
  try {
    await LoginHistory.create({
      user: user ? user._id : undefined,
      phone: user ? user.phone : req.body.phone,
      method, success, reason,
      ip: req.ip, userAgent: req.headers['user-agent'],
      device: sessionService.parseUA(req.headers['user-agent']),
    });
  } catch { /* non-fatal */ }
}

/** Verify a 2FA code OR a one-time backup code. Consumes backup codes. */
async function verifyTwoFactor(user, code) {
  if (!code) return false;
  const secret = user.twoFactorSecret ? decrypt(user.twoFactorSecret) : null;
  if (secret && totp.verifyToken(secret, code)) return true;
  // backup code path
  const hash = sha256(String(code).toUpperCase());
  const idx = (user.twoFactorBackupCodes || []).indexOf(hash);
  if (idx !== -1) {
    user.twoFactorBackupCodes.splice(idx, 1);
    await user.save();
    return true;
  }
  return false;
}

// POST /auth/send-otp  { phone }
exports.sendOtp = asyncHandler(async (req, res) => {
  const { phone } = req.body;
  if (!/^[6-9]\d{9}$/.test(phone || '')) throw ApiError.badRequest('Enter a valid 10-digit mobile number');
  if (await isOnCooldown(phone)) throw ApiError.tooMany('Please wait before requesting another code.');

  const otp = generateOtp();
  await saveOtp(phone, otp);
  await sendSms(phone, otp);
  // The customer app's OTP screen used to hardcode 6 digits for phone OTPs —
  // correct ONLY when Twilio Verify is actually configured (it always sends
  // 6-digit codes and ignores our locally-generated one). Without Twilio
  // (dev/local, no SMS provider), sendSms() dev-logs our own LOCAL code,
  // which is config.otp.length = 4 digits — a real mismatch that made phone
  // login impossible in dev: the input required 6 digits before submitting,
  // but the actual code was only 4. Tell the frontend the real length.
  sendResponse(res, 200, 'OTP sent successfully', { phone, expiresInSeconds: config.otp.ttlSeconds, otpLength: twilioEnabled ? 6 : config.otp.length });
});

// POST /auth/verify-otp  { phone, otp, name?, role?, referralCode? }
exports.verifyOtp = asyncHandler(async (req, res) => {
  const { phone, otp, name, role, referralCode } = req.body;
  if (!phone || !otp) throw ApiError.badRequest('Phone and OTP are required');

  const result = await verifyOtp(phone, otp, { isPhone: true });
  if (!result.ok) {
    const map = {
      too_many_attempts: 'Too many incorrect attempts. Request a new code.',
      expired: 'Code expired. Please request a new one.',
      invalid: 'Incorrect code. Please try again.',
    };
    throw ApiError.badRequest(map[result.reason] || 'Verification failed');
  }

  let user = await User.findOne({ phone }).select('+twoFactorSecret +twoFactorBackupCodes');
  let isNew = false;
  if (!user) {
    // referral handling
    let referredBy;
    if (referralCode) {
      const ref = await User.findOne({ referralCode: referralCode.toUpperCase() });
      if (ref) referredBy = ref._id;
    }
    user = await User.create({
      phone,
      name: name || undefined,
      role: role && ['customer', 'owner'].includes(role) ? role : 'customer',
      phoneVerified: true,
      referredBy,
      lastLoginAt: new Date(),
    });
    isNew = true;
    sendWelcomeNotification(user);

    // Referral bonus now pays out when this new user completes their FIRST
    // booking, not here at signup (see booking.controller.js updateStatus) —
    // avoids rewarding referrers for fake signups that never actually book.
  } else {
    user.phoneVerified = true;
    user.lastLoginAt = new Date();
    if (name && !user.name) user.name = name;
    resolveLoginRole(user, role);
    await user.save();
  }

  // 2FA gate
  if (user.twoFactorEnabled) {
    if (!req.body.twoFactorCode) {
      return sendResponse(res, 200, 'Two-factor code required', { twoFactorRequired: true, phone });
    }
    if (!(await verifyTwoFactor(user, req.body.twoFactorCode))) {
      await logLogin(user, '2fa', false, req, 'invalid_2fa');
      throw ApiError.unauthorized('Invalid two-factor code');
    }
  }

  const tokens = await sessionService.createSession(user, reqCtx(req));
  await logLogin(user, 'otp', true, req);
  sendResponse(res, isNew ? 201 : 200, isNew ? 'Account created' : 'Logged in successfully', {
    isNewUser: isNew, user: publicUser(user), ...tokens,
  });
});

// POST /auth/firebase-login  { idToken, name?, role?, referralCode? }
// Phone login/signup via Firebase Phone Auth (client verifies OTP with Firebase's
// own SMS, sends us the resulting ID token; we just verify it server-side and
// issue our own GlowOra session — mirrors verifyOtp's user-lookup/create logic).
exports.firebaseLogin = asyncHandler(async (req, res) => {
  const { idToken, name, role, referralCode } = req.body;
  if (!idToken) throw ApiError.badRequest('idToken is required');
  if (!firebaseEnabled) throw ApiError.internal('Phone sign-in is not configured on the server');

  let decoded;
  try {
    decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
  } catch (err) {
    throw ApiError.unauthorized('Invalid or expired sign-in token');
  }

  const rawPhone = decoded.phone_number; // E.164, e.g. +919876543210
  if (!rawPhone) throw ApiError.badRequest('No phone number on this sign-in token');
  const phone = rawPhone.replace(/^\+91/, '');
  if (!/^[6-9]\d{9}$/.test(phone)) throw ApiError.badRequest('Unsupported phone number');

  let user = await User.findOne({ phone }).select('+twoFactorSecret +twoFactorBackupCodes');
  let isNew = false;
  if (!user) {
    let referredBy;
    if (referralCode) {
      const ref = await User.findOne({ referralCode: referralCode.toUpperCase() });
      if (ref) referredBy = ref._id;
    }
    user = await User.create({
      phone,
      name: name || undefined,
      role: role && ['customer', 'owner'].includes(role) ? role : 'customer',
      phoneVerified: true,
      referredBy,
      lastLoginAt: new Date(),
    });
    isNew = true;
    sendWelcomeNotification(user);

    // Referral bonus now pays out when this new user completes their FIRST
    // booking, not here at signup (see booking.controller.js updateStatus).
  } else {
    user.phoneVerified = true;
    user.lastLoginAt = new Date();
    if (name && !user.name) user.name = name;
    resolveLoginRole(user, role);
    await user.save();
  }

  if (user.twoFactorEnabled) {
    if (!req.body.twoFactorCode) {
      return sendResponse(res, 200, 'Two-factor code required', { twoFactorRequired: true, phone });
    }
    if (!(await verifyTwoFactor(user, req.body.twoFactorCode))) {
      await logLogin(user, '2fa', false, req, 'invalid_2fa');
      throw ApiError.unauthorized('Invalid two-factor code');
    }
  }

  const tokens = await sessionService.createSession(user, reqCtx(req));
  await logLogin(user, 'firebase_phone', true, req);
  sendResponse(res, isNew ? 201 : 200, isNew ? 'Account created' : 'Logged in successfully', {
    isNewUser: isNew, user: publicUser(user), ...tokens,
  });
});

// POST /auth/google-login  { idToken, role? }
// Google Sign-In — client gets an ID token from @react-native-google-signin/google-signin;
// we verify it against our registered OAuth client IDs and issue our own GlowOra session.
exports.googleLogin = asyncHandler(async (req, res) => {
  const { idToken, role } = req.body;
  if (!idToken) throw ApiError.badRequest('idToken is required');
  if (!googleClient) throw ApiError.internal('Google sign-in is not configured on the server');

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: config.googleClientIds });
    payload = ticket.getPayload();
  } catch (err) {
    throw ApiError.unauthorized('Invalid or expired Google sign-in token');
  }

  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) throw ApiError.badRequest('No email on this Google account');
  if (payload.email_verified === false) throw ApiError.unauthorized('Google email is not verified');

  let user = await User.findOne({ email }).select('+twoFactorSecret +twoFactorBackupCodes');
  let isNew = false;
  if (!user) {
    user = await User.create({
      email,
      name: payload.name || undefined,
      avatar: payload.picture || undefined,
      role: role && ['customer', 'owner'].includes(role) ? role : 'customer',
      emailVerified: true,
      lastLoginAt: new Date(),
    });
    isNew = true;
    sendWelcomeNotification(user);
  } else {
    user.emailVerified = true;
    user.lastLoginAt = new Date();
    if (payload.name && !user.name) user.name = payload.name;
    if (payload.picture && !user.avatar) user.avatar = payload.picture;
    resolveLoginRole(user, role);
    await user.save();
  }

  if (user.twoFactorEnabled) {
    if (!req.body.twoFactorCode) {
      return sendResponse(res, 200, 'Two-factor code required', { twoFactorRequired: true, email });
    }
    if (!(await verifyTwoFactor(user, req.body.twoFactorCode))) {
      await logLogin(user, '2fa', false, req, 'invalid_2fa');
      throw ApiError.unauthorized('Invalid two-factor code');
    }
  }

  const tokens = await sessionService.createSession(user, reqCtx(req));
  await logLogin(user, 'google', true, req);
  sendResponse(res, isNew ? 201 : 200, isNew ? 'Account created' : 'Logged in successfully', {
    isNewUser: isNew, user: publicUser(user), ...tokens,
  });
});

// POST /auth/apple-login  { identityToken, fullName?, role? }
// Sign in with Apple — client gets an identityToken from
// expo-apple-authentication's native prompt; we verify it against Apple's
// public keys (audience = our app bundle IDs) and issue our own GlowOra
// session. Mirrors googleLogin above almost exactly.
//
// Two Apple quirks googleLogin doesn't have to deal with:
//  1. Apple only sends the user's name ONCE, in the native response itself
//     (never in the identityToken, and never again on subsequent logins) —
//     so the client must pass it the first time as `fullName`, and we save
//     it then-and-only-then.
//  2. `email` may be a private relay address ("Hide My Email") — that's
//     still a usable, unique email for our purposes, just not their real one.
exports.appleLogin = asyncHandler(async (req, res) => {
  const { identityToken, fullName, role } = req.body;
  if (!identityToken) throw ApiError.badRequest('identityToken is required');
  if (!config.appleClientIds.length) throw ApiError.internal('Apple sign-in is not configured on the server');

  let payload;
  try {
    payload = await appleSignin.verifyIdToken(identityToken, {
      audience: config.appleClientIds,
      ignoreExpiration: false,
    });
  } catch (err) {
    throw ApiError.unauthorized('Invalid or expired Apple sign-in token');
  }

  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) throw ApiError.badRequest('No email on this Apple account');
  // Apple's identityToken carries email_verified as the STRING 'true'/'false'
  // (not a boolean, unlike Google's payload) — mirror googleLogin's check.
  if (payload.email_verified === false || payload.email_verified === 'false') {
    throw ApiError.unauthorized('Apple email is not verified');
  }

  let user = await User.findOne({ email }).select('+twoFactorSecret +twoFactorBackupCodes');
  let isNew = false;
  if (!user) {
    user = await User.create({
      email,
      name: fullName || undefined,
      role: role && ['customer', 'owner'].includes(role) ? role : 'customer',
      emailVerified: true,
      lastLoginAt: new Date(),
    });
    isNew = true;
    sendWelcomeNotification(user);
  } else {
    user.emailVerified = true;
    user.lastLoginAt = new Date();
    if (fullName && !user.name) user.name = fullName;
    resolveLoginRole(user, role);
    await user.save();
  }

  if (user.twoFactorEnabled) {
    if (!req.body.twoFactorCode) {
      return sendResponse(res, 200, 'Two-factor code required', { twoFactorRequired: true, email });
    }
    if (!(await verifyTwoFactor(user, req.body.twoFactorCode))) {
      await logLogin(user, '2fa', false, req, 'invalid_2fa');
      throw ApiError.unauthorized('Invalid two-factor code');
    }
  }

  const tokens = await sessionService.createSession(user, reqCtx(req));
  await logLogin(user, 'apple', true, req);
  sendResponse(res, isNew ? 201 : 200, isNew ? 'Account created' : 'Logged in successfully', {
    isNewUser: isNew, user: publicUser(user), ...tokens,
  });
});

// POST /auth/login  { phone|email, password, role? }  — login by phone OR email.
// Used by both the customer app (email+password mode) and the partner app —
// unlike the OTP-based logins above, this never called resolveLoginRole, so
// someone who last logged into the partner app (role='owner'/'staff') and
// then password-logs-into the customer app kept the stale active role and
// got 403'd on every customer-only action (booking create, etc).
exports.login = asyncHandler(async (req, res) => {
  const { phone, email, password, role } = req.body;
  const identifier = email ? String(email).trim().toLowerCase() : phone;
  if (!identifier || !password) throw ApiError.badRequest('Phone/email and password are required');

  const query = email ? { email: identifier } : { phone: identifier };
  const user = await User.findOne(query)
    .select('+password +loginAttempts +lockUntil +active +twoFactorSecret +twoFactorBackupCodes');
  if (!user || !user.password) { await logLogin(user, 'password', false, req, 'no_account'); throw ApiError.unauthorized('Invalid credentials'); }
  if (user.active === false) throw ApiError.forbidden('Your account has been blocked.');

  if (user.lockUntil && user.lockUntil > Date.now()) {
    throw ApiError.tooMany('Account temporarily locked due to failed attempts. Try again later.');
  }

  const ok = await comparePassword(password, user.password);
  if (!ok) {
    user.loginAttempts = (user.loginAttempts || 0) + 1;
    if (user.loginAttempts >= config.security.maxLoginAttempts) {
      user.lockUntil = new Date(Date.now() + config.security.lockMinutes * 60 * 1000);
      user.loginAttempts = 0;
    }
    await user.save();
    await logLogin(user, 'password', false, req, 'bad_password');
    throw ApiError.unauthorized('Invalid credentials');
  }

  // 2FA gate
  if (user.twoFactorEnabled) {
    if (!req.body.twoFactorCode) {
      return sendResponse(res, 200, 'Two-factor code required', { twoFactorRequired: true, phone });
    }
    if (!(await verifyTwoFactor(user, req.body.twoFactorCode))) {
      await logLogin(user, '2fa', false, req, 'invalid_2fa');
      throw ApiError.unauthorized('Invalid two-factor code');
    }
  }

  user.loginAttempts = 0;
  user.lockUntil = undefined;
  user.lastLoginAt = new Date();
  resolveLoginRole(user, role);
  await user.save();

  const tokens = await sessionService.createSession(user, reqCtx(req));
  await logLogin(user, 'password', true, req);
  sendResponse(res, 200, 'Logged in successfully', { user: publicUser(user), ...tokens });
});

// POST /auth/set-password  (protected) { password }
exports.setPassword = asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!isStrong(password)) throw ApiError.badRequest('Password must be 8+ chars with letters and numbers');
  const user = await User.findById(req.user._id).select('+password');
  user.password = await hashPassword(password);
  user.passwordChangedAt = new Date();
  await user.save();
  sendResponse(res, 200, 'Password set successfully');
});

// POST /auth/forgot-password  { phone } — sends OTP as reset code
exports.forgotPassword = asyncHandler(async (req, res) => {
  const { phone } = req.body;
  const user = await User.findOne({ phone });
  if (!user) throw ApiError.notFound('No account with that number');
  if (await isOnCooldown(phone)) throw ApiError.tooMany('Please wait before requesting another code.');
  const otp = generateOtp();
  await saveOtp(phone, otp);
  await sendSms(phone, otp);
  sendResponse(res, 200, 'Reset code sent', { phone });
});

// POST /auth/reset-password  { phone, otp, password }
exports.resetPassword = asyncHandler(async (req, res) => {
  const { phone, otp, password } = req.body;
  if (!phone || !otp || !password) throw ApiError.badRequest('phone, otp and password are required');
  if (!isStrong(password)) throw ApiError.badRequest('Password must be 8+ chars with letters and numbers');
  const result = await verifyOtp(phone, otp, { isPhone: true });
  if (!result.ok) throw ApiError.badRequest('Invalid or expired code');
  const user = await User.findOne({ phone }).select('+password');
  if (!user) throw ApiError.notFound('Account not found');
  user.password = await hashPassword(password);
  user.passwordChangedAt = new Date();
  user.loginAttempts = 0;
  user.lockUntil = undefined;
  await user.save();
  sendResponse(res, 200, 'Password reset successfully');
});

// POST /auth/refresh  { refreshToken }  — session-backed rotation + reuse detection
exports.refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw ApiError.badRequest('Refresh token required');
  try {
    const tokens = await sessionService.rotate(refreshToken, reqCtx(req));
    sendResponse(res, 200, 'Token refreshed', tokens);
  } catch (err) {
    if (err.code === 'REUSE') throw ApiError.unauthorized('Security alert: token reuse detected. Please log in again.');
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }
});

// POST /auth/logout  (protected)  { fcmToken? }
exports.logout = asyncHandler(async (req, res) => {
  if (req.user.sid) await sessionService.revoke(req.user.sid, 'logout');
  if (req.body.fcmToken) {
    await User.findByIdAndUpdate(req.user._id, { $pull: { fcmTokens: req.body.fcmToken } });
  }
  sendResponse(res, 200, 'Logged out successfully');
});

// POST /auth/fcm-token  (protected)  { fcmToken }
exports.registerFcm = asyncHandler(async (req, res) => {
  const { fcmToken } = req.body;
  if (!fcmToken) throw ApiError.badRequest('fcmToken required');
  await User.findByIdAndUpdate(req.user._id, { $addToSet: { fcmTokens: fcmToken } });
  sendResponse(res, 200, 'Device registered for notifications');
});

// GET /auth/me  (protected)
exports.getMe = asyncHandler(async (req, res) => {
  sendResponse(res, 200, 'Current user', { user: publicUser(req.user) });
});

// PATCH /auth/notification-prefs  (protected)  { bookings?, offers?, chat?, system? }
// Per-category toggle — matches the keys notification.service.js checks
// before sending a push (TYPE_TO_PREF maps Notification `type` → these keys).
exports.updateNotificationPrefs = asyncHandler(async (req, res) => {
  const allowed = ['bookings', 'offers', 'chat', 'system'];
  const user = await User.findById(req.user._id);
  if (!user.notificationPrefs) user.notificationPrefs = {};
  allowed.forEach((k) => { if (typeof req.body[k] === 'boolean') user.notificationPrefs[k] = req.body[k]; });
  await user.save();
  sendResponse(res, 200, 'Notification preferences updated', { user: publicUser(user) });
});

const EMAIL_RE = /^\S+@\S+\.\S+$/;

// POST /auth/send-email-otp  { email }
exports.sendEmailOtp = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw ApiError.badRequest('Enter a valid email address');
  if (await isOnCooldown(email)) throw ApiError.tooMany('Please wait before requesting another code.');
  const otp = generateOtp();
  await saveOtp(email, otp);       // otp store keys on any string, so email works
  await sendEmailOtp(email, otp);
  sendResponse(res, 200, 'Verification code sent to your email', { email, expiresInSeconds: config.otp.ttlSeconds });
});

// POST /auth/verify-email  { email, otp, name?, phone? }
// Verifies the email code. Logs the user in (creates account if new).
exports.verifyEmail = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const { otp, name, phone } = req.body;
  if (!EMAIL_RE.test(email) || !otp) throw ApiError.badRequest('Email and code are required');

  const result = await verifyOtp(email, otp);
  if (!result.ok) {
    const map = { too_many_attempts: 'Too many incorrect attempts. Request a new code.', expired: 'Code expired. Please request a new one.', invalid: 'Incorrect code. Please try again.' };
    throw ApiError.badRequest(map[result.reason] || 'Verification failed');
  }

  let user = await User.findOne({ email });
  let isNew = false;
  if (!user) {
    // if a phone was supplied and matches an existing account, attach email to it
    if (phone) user = await User.findOne({ phone });
    if (!user) {
      user = await User.create({ email, name: name || undefined, phone: phone || undefined, role: 'customer', emailVerified: true, lastLoginAt: new Date() });
      isNew = true;
      sendWelcomeNotification(user);
    }
  }
  user.email = email;
  user.emailVerified = true;
  user.lastLoginAt = new Date();
  if (name && !user.name) user.name = name;
  // This endpoint is only ever called from the customer app's email-login
  // flow — unlike the other login methods above, it never took a `role`
  // param at all, so an owner/staff account logging into the customer app
  // via email OTP kept its stale active role and got 403'd on customer-only
  // actions. Always resolve back to 'customer' here.
  resolveLoginRole(user, 'customer');
  await user.save();

  const tokens = await sessionService.createSession(user, reqCtx(req));
  await logLogin(user, 'email_otp', true, req);
  sendResponse(res, isNew ? 201 : 200, isNew ? 'Account created' : 'Email verified', {
    isNewUser: isNew, user: publicUser(user), ...tokens,
  });
});
