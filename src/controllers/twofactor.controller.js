/**
 * Two-factor authentication (TOTP) controller.
 * Flow: setup -> (scan QR) -> enable(verify) -> [login now requires a code].
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const totp = require('../utils/totp');
const { encrypt, decrypt, sha256 } = require('../utils/encryption');
const { comparePassword } = require('../utils/password');
const config = require('../config/env');
const User = require('../models/User');

// POST /2fa/setup  — generate a secret + otpauth URL (not yet enabled)
exports.setup = asyncHandler(async (req, res) => {
  const secret = totp.generateSecret();
  const user = await User.findById(req.user._id).select('+twoFactorSecret');
  user.twoFactorSecret = encrypt(secret);
  await user.save();
  const url = totp.otpauthUrl(secret, user.phone, config.security.twoFactorIssuer);
  sendResponse(res, 200, 'Scan this in your authenticator app, then verify a code to enable 2FA', {
    secret, otpauthUrl: url,
  });
});

// POST /2fa/enable  { token }  — verify the first code, activate 2FA, return backup codes
exports.enable = asyncHandler(async (req, res) => {
  const { token } = req.body;
  const user = await User.findById(req.user._id).select('+twoFactorSecret');
  if (!user.twoFactorSecret) throw ApiError.badRequest('Run 2FA setup first');
  const secret = decrypt(user.twoFactorSecret);
  if (!totp.verifyToken(secret, token)) throw ApiError.badRequest('Invalid code — try again');

  const backupCodes = totp.generateBackupCodes(config.security.backupCodeCount);
  user.twoFactorEnabled = true;
  user.twoFactorVerifiedAt = new Date();
  user.twoFactorBackupCodes = backupCodes.map((c) => sha256(c));
  await user.save();

  sendResponse(res, 200, '2FA enabled. Save these backup codes somewhere safe — each works once.', {
    backupCodes,
  });
});

// POST /2fa/disable  { token | password }  — turn off 2FA (requires proof)
exports.disable = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+twoFactorSecret +twoFactorBackupCodes +password');
  if (!user.twoFactorEnabled) throw ApiError.badRequest('2FA is not enabled');

  let ok = false;
  if (req.body.token) ok = totp.verifyToken(decrypt(user.twoFactorSecret), req.body.token);
  else if (req.body.password) ok = await comparePassword(req.body.password, user.password);
  if (!ok) throw ApiError.unauthorized('Verification failed');

  user.twoFactorEnabled = false;
  user.twoFactorSecret = undefined;
  user.twoFactorBackupCodes = [];
  await user.save();
  sendResponse(res, 200, '2FA disabled');
});

// POST /2fa/backup-codes/regenerate  { token }
exports.regenerateBackupCodes = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+twoFactorSecret +twoFactorBackupCodes');
  if (!user.twoFactorEnabled) throw ApiError.badRequest('2FA is not enabled');
  if (!totp.verifyToken(decrypt(user.twoFactorSecret), req.body.token)) {
    throw ApiError.unauthorized('Invalid code');
  }
  const backupCodes = totp.generateBackupCodes(config.security.backupCodeCount);
  user.twoFactorBackupCodes = backupCodes.map((c) => sha256(c));
  await user.save();
  sendResponse(res, 200, 'New backup codes generated', { backupCodes });
});

// GET /2fa/status
exports.status = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+twoFactorBackupCodes');
  sendResponse(res, 200, '2FA status', {
    enabled: user.twoFactorEnabled,
    backupCodesRemaining: user.twoFactorBackupCodes ? user.twoFactorBackupCodes.length : 0,
  });
});
