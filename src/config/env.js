/**
 * Centralised environment config.
 * Loads .env and exposes a typed, validated config object.
 * Import this instead of reading process.env directly elsewhere.
 */
const dotenv = require('dotenv');
dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

const required = ['MONGO_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  if (isProd) {
    // eslint-disable-next-line no-console
    console.error(`❌ Missing required env vars in production: ${missing.join(', ')}. Refusing to start.`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.warn(`⚠️  Missing env vars: ${missing.join(', ')} — using dev placeholders. Set them in .env before production.`);
}

// Known dev-only placeholder/fallback secrets — if any of these literal values
// are still in effect in production (either left in .env or falling back to
// the hardcoded defaults below), refuse to start rather than run with a
// guessable secret.
const DEV_SECRET_MARKERS = ['dev_', 'change_me', 'changeme', 'secret', 'admin@123', 'password', '123456'];
function looksLikeDevSecret(value) {
  if (!value) return true;
  const v = value.toLowerCase();
  return DEV_SECRET_MARKERS.some((marker) => v.includes(marker));
}

if (isProd) {
  const secretsToCheck = {
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
    COOKIE_SECRET: process.env.COOKIE_SECRET,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD,
  };
  const weak = Object.entries(secretsToCheck).filter(([, v]) => looksLikeDevSecret(v));
  if (weak.length) {
    // eslint-disable-next-line no-console
    console.error(
      `❌ Refusing to start in production: the following secrets are missing or look like dev/placeholder values: ${weak
        .map(([k]) => k)
        .join(', ')}. Generate strong random values (e.g. \`openssl rand -hex 32\`) and set them in the production environment.`
    );
    process.exit(1);
  }
}

const config = {
  env: process.env.NODE_ENV || 'development',
  isProd,
  port: parseInt(process.env.PORT, 10) || 5000,
  apiUrl: process.env.API_URL || 'http://localhost:5000',

  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/glowora',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev_access_secret_change_me_min_32_chars',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_change_me_min_32_chars',
    accessExpire: process.env.JWT_ACCESS_EXPIRE || '15m',
    refreshExpire: process.env.JWT_REFRESH_EXPIRE || '30d',
  },
  cookieSecret: process.env.COOKIE_SECRET || 'dev_cookie_secret_change_me',
  encryptionKey: process.env.ENCRYPTION_KEY || 'dev_encryption_key_change_me_32byteslong!!',

  msg91: {
    apiKey: process.env.MSG91_API_KEY,
    senderId: process.env.MSG91_SENDER_ID || 'GLOWORA',
    templateId: process.env.MSG91_TEMPLATE_ID,
  },

  // Twilio Verify — preferred SMS-OTP provider (no billing-plan gate like
  // Firebase Phone Auth; pay-per-SMS with a free trial credit). Falls back
  // to MSG91, then to the dev console-log OTP if neither is configured.
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID,
  },

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    secret: process.env.RAZORPAY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  },

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },

  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  },

  // WhatsApp Cloud API (Meta) — used for booking reminders alongside push
  // notifications. Optional: if unset, whatsapp.service.js silently no-ops
  // (same "dev fallback" convention as twilio/otp.js). Get these from
  // Meta for Developers > WhatsApp > API Setup once the app is set up.
  whatsapp: {
    apiToken: process.env.WHATSAPP_API_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v20.0',
  },

  googleMapsKey: process.env.GOOGLE_MAPS_API_KEY,

  // Google Sign-In — accepted OAuth client IDs (Android + Web), comma-separated
  googleClientIds: (process.env.GOOGLE_CLIENT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),

  // Sign in with Apple — accepted audiences, comma-separated (the iOS bundle
  // IDs of both apps, e.g. life.glowora.app,life.glowora.partner). No private
  // key needed — we only verify the identityToken Apple already signed,
  // never mint our own Apple-side tokens.
  appleClientIds: (process.env.APPLE_CLIENT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),

  agora: {
    appId: process.env.AGORA_APP_ID,
    appCertificate: process.env.AGORA_APP_CERTIFICATE,
  },

  sendgrid: {
    apiKey: process.env.SENDGRID_API_KEY,
    fromEmail: process.env.FROM_EMAIL || 'noreply@glowora.life',
    fromName: process.env.FROM_NAME || 'GlowOra',
  },

  seedAdmin: {
    phone: process.env.SEED_ADMIN_PHONE || '9999999999',
    password: process.env.SEED_ADMIN_PASSWORD || 'Admin@123',
    name: process.env.SEED_ADMIN_NAME || 'Super Admin',
  },

  cors: {
    customerUrl: process.env.CUSTOMER_APP_URL || 'http://localhost:5173',
    partnerUrl: process.env.PARTNER_WEB_URL || 'http://localhost:5174',
    adminUrl: process.env.ADMIN_WEB_URL || 'http://localhost:5175',
  },

  commissionPercent: parseFloat(process.env.PLATFORM_COMMISSION_PERCENT) || 12,
  tokenAmount: parseInt(process.env.TOKEN_AMOUNT, 10) || 49,
  onlineDiscountPercent: parseFloat(process.env.ONLINE_DISCOUNT_PERCENT) || 5,
  loyaltyPointsPerRupee: parseFloat(process.env.LOYALTY_POINTS_PER_RUPEE) || 0.1,
  referralBonus: parseInt(process.env.REFERRAL_BONUS, 10) || 50,
  // No-show / very-late-cancellation penalty — a small flat amount debited
  // from the customer's wallet (see booking.controller.js cancel/updateStatus).
  // Best-effort: if the wallet balance can't cover it, the penalty is simply
  // skipped rather than blocking the cancel/no-show flow.
  noShowPenaltyAmount: parseInt(process.env.NO_SHOW_PENALTY_AMOUNT, 10) || 99,
  lateCancelWindowHours: parseFloat(process.env.LATE_CANCEL_WINDOW_HOURS) || 2,

  otp: {
    length: 4,
    ttlSeconds: 300,
    resendCooldownSeconds: 30,
    maxAttempts: 5,
  },

  security: {
    maxLoginAttempts: 5,
    lockMinutes: 15,
    bcryptRounds: 12,
    twoFactorIssuer: 'GlowOra',
    backupCodeCount: 10,
    maxSessionsPerUser: 10,
    adminIpAllowlist: (process.env.ADMIN_IP_ALLOWLIST || '').split(',').map((s) => s.trim()).filter(Boolean),
  },

  defaults: {
    currency: process.env.DEFAULT_CURRENCY || 'INR',
    country: process.env.DEFAULT_COUNTRY || 'IN',
    timezone: process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata',
    locale: process.env.DEFAULT_LOCALE || 'en',
  },
  supportedCurrencies: (process.env.SUPPORTED_CURRENCIES || 'INR,USD,AED,GBP,SGD').split(','),
  supportedLocales: (process.env.SUPPORTED_LOCALES || 'en,hi,pa,ar').split(','),
};

module.exports = config;
