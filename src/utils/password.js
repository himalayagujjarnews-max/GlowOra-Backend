/**
 * Password hashing helpers (bcrypt).
 */
const bcrypt = require('bcryptjs');
const config = require('../config/env');

async function hashPassword(plain) {
  const salt = await bcrypt.genSalt(config.security.bcryptRounds);
  return bcrypt.hash(plain, salt);
}

async function comparePassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

/** Basic strength check: min 8 chars, at least one letter and one number. */
function isStrong(password) {
  return typeof password === 'string' && password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

module.exports = { hashPassword, comparePassword, isStrong };
