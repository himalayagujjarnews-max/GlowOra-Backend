/**
 * Seeds baseline data on startup: subscription plans (salon + customer),
 * and the Phase-1 launch cities. Idempotent — only creates what's missing.
 */
const SubscriptionPlan = require('../models/SubscriptionPlan');
const City = require('../models/City');
const logger = require('./logger');

const PLANS = [
  { audience: 'salon', key: 'free', name: 'Free', price: 0, commissionPercent: 15, maxServices: 5, order: 1,
    features: ['Basic listing', 'Up to 5 services', '15% commission'] },
  { audience: 'salon', key: 'basic', name: 'Basic', price: 499, commissionPercent: 12, maxServices: 0, order: 2,
    features: ['Unlimited services', '12% commission', 'Analytics dashboard'] },
  { audience: 'salon', key: 'pro', name: 'Pro', price: 1999, commissionPercent: 10, maxServices: 0, order: 3,
    features: ['10% commission', 'Featured listing', 'Priority support', 'WhatsApp integration'] },
  { audience: 'customer', key: 'glow_pass', name: 'Glow Pass', price: 999, includedServices: 1, order: 1,
    features: ['1 free service / month', 'Member-only discounts', 'Priority booking'] },
];

const CITIES = [
  { name: 'Chandigarh', state: 'Chandigarh', launchStatus: 'live' },
  { name: 'Panchkula', state: 'Haryana', launchStatus: 'live' },
  { name: 'Mohali', state: 'Punjab', launchStatus: 'live' },
  { name: 'Zirakpur', state: 'Punjab', launchStatus: 'live' },
  { name: 'Ambala', state: 'Haryana', launchStatus: 'live' },
  { name: 'Karnal', state: 'Haryana', launchStatus: 'coming_soon' },
  { name: 'Yamunanagar', state: 'Haryana', launchStatus: 'coming_soon' },
  { name: 'Roorkee', state: 'Uttarakhand', launchStatus: 'coming_soon' },
  { name: 'Saharanpur', state: 'Uttar Pradesh', launchStatus: 'coming_soon' },
];

module.exports = async function seedData() {
  try {
    for (const p of PLANS) {
      await SubscriptionPlan.updateOne({ key: p.key }, { $setOnInsert: p }, { upsert: true });
    }
    for (const c of CITIES) {
      await City.updateOne({ name: c.name }, { $setOnInsert: c }, { upsert: true });
    }
    logger.info('🌱 Seed data ensured (subscription plans + launch cities)');
  } catch (err) {
    logger.error(`seedData failed: ${err.message}`);
  }
};
