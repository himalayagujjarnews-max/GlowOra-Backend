/**
 * TOTP (RFC 6238) 2-factor authentication — compatible with Google
 * Authenticator, Authy, etc. Pure Node crypto, no external dependency.
 */
const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(str) {
  const clean = str.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Generate a new base32 secret for a user. */
function generateSecret(length = 20) {
  return base32Encode(crypto.randomBytes(length));
}

/** Compute the TOTP code for a secret at a given time step. */
function generateToken(secret, timeStep) {
  const key = base32Decode(secret);
  const counter = timeStep !== undefined ? timeStep : Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return (code % 1000000).toString().padStart(6, '0');
}

/** Verify a submitted token allowing +/- 1 window for clock drift. */
function verifyToken(secret, token, window = 1) {
  if (!secret || !token) return false;
  const current = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    if (crypto.timingSafeEqual(Buffer.from(generateToken(secret, current + i)), Buffer.from(String(token).padStart(6, '0')))) {
      return true;
    }
  }
  return false;
}

/** otpauth:// URI for QR codes in authenticator apps. */
function otpauthUrl(secret, account, issuer = 'GlowOra') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Generate N single-use backup codes (returned plain; store hashed). */
function generateBackupCodes(n = 10) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    codes.push(crypto.randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g).join('-'));
  }
  return codes;
}

module.exports = { generateSecret, generateToken, verifyToken, otpauthUrl, generateBackupCodes };
