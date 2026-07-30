/**
 * Seeds the first admin account on startup if it doesn't exist.
 * Credentials come from SEED_ADMIN_* env vars.
 */
const User = require('../models/User');
const config = require('../config/env');
const { hashPassword } = require('./password');
const logger = require('./logger');

module.exports = async function seedAdmin() {
  try {
    const existing = await User.findOne({ phone: config.seedAdmin.phone });
    if (existing) {
      if (existing.role !== 'admin') {
        existing.role = 'admin';
        await existing.save();
      }
      return;
    }
    const password = await hashPassword(config.seedAdmin.password);
    await User.create({
      name: config.seedAdmin.name,
      phone: config.seedAdmin.phone,
      role: 'admin',
      password,
      phoneVerified: true,
    });
    logger.info(`👑 Seeded admin account (phone: ${config.seedAdmin.phone})`);
  } catch (err) {
    logger.error(`seedAdmin failed: ${err.message}`);
  }
};
