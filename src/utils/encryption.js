/**
 * Field-level encryption using AES-256-GCM.
 * Used to encrypt PII / bank details at rest.
 *
 * Key is derived from ENCRYPTION_KEY (32 bytes recommended, hex or utf8).
 * Output format: iv(hex):authTag(hex):ciphertext(hex)
 */
const crypto = require('crypto');
const config = require('../config/env');
const logger = require('./logger');

const ALGO = 'aes-256-gcm';

function getKey() {
  const raw = config.encryptionKey;
  // Accept hex (64 chars) or derive a 32-byte key from any string.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.createHash('sha256').update(String(raw)).digest();
}

function encrypt(plainText) {
  if (plainText === null || plainText === undefined || plainText === '') return plainText;
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
    let enc = cipher.update(String(plainText), 'utf8', 'hex');
    enc += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${tag}:${enc}`;
  } catch (err) {
    logger.error(`encrypt failed: ${err.message}`);
    throw err;
  }
}

function decrypt(payload) {
  if (!payload || typeof payload !== 'string' || !payload.includes(':')) return payload;
  try {
    const [ivHex, tagHex, data] = payload.split(':');
    const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let dec = decipher.update(data, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch (err) {
    logger.error(`decrypt failed: ${err.message}`);
    return null;
  }
}

/** One-way hash for lookups/indexing of sensitive values (e.g. find by phone hash). */
function blindIndex(value) {
  return crypto.createHmac('sha256', getKey()).update(String(value)).digest('hex');
}

/** SHA-256 hex hash (for tokens stored server-side). */
function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** Cryptographically secure random token. */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = { encrypt, decrypt, blindIndex, sha256, randomToken };
