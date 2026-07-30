# GlowOra Security & Compliance

This backend is built to enterprise / international standards. This document is the security checklist to review before every launch and every market expansion.

## Authentication & Session Security

- [x] OTP login (cryptographically random, Redis-stored, 5-min TTL, resend cooldown, max-attempt lock)
- [x] Password login for owner/admin (bcrypt, 12 rounds, strength check)
- [x] Account lockout after 5 failed attempts (15-min lock)
- [x] **TOTP 2-factor auth** (Google Authenticator compatible) + one-time backup codes
- [x] 2FA challenge enforced on both OTP and password login
- [x] JWT access tokens (15 min) + refresh tokens (30 days)
- [x] **Session-backed refresh tokens** — stored as SHA-256 hashes, never plaintext
- [x] **Refresh-token rotation** with **reuse/theft detection** (revokes the whole token family)
- [x] Device / session management — list active devices, revoke one or all
- [x] Login history with suspicious-login flagging
- [x] Max sessions per user (oldest auto-revoked)

## Access Control

- [x] Role-based access control (customer / owner / staff / admin)
- [x] Granular permission layer (`requirePermission`) for future sub-roles
- [x] Admin IP allowlist (configurable via `ADMIN_IP_ALLOWLIST`)
- [x] Ownership checks on every salon/booking/resource mutation

## Data Protection

- [x] **AES-256-GCM field encryption** at rest for bank account numbers & PAN
- [x] Blind-index hashing available for encrypted-field lookups
- [x] Secrets (2FA secret, backup codes) stored encrypted / hashed
- [x] `select: false` on all sensitive fields (password, tokens, secrets)
- [x] **GDPR / India DPDP**: consent capture + versioning, data export (portability), account erasure (anonymisation)
- [x] Sensitive fields redacted in audit logs

## API Hardening

- [x] Helmet with strict CSP, HSTS (1yr, preload), no-referrer, frameAncestors none
- [x] CORS whitelist (only the three known frontends)
- [x] Rate limiting (global + strict on auth)
- [x] NoSQL injection sanitisation (express-mongo-sanitize)
- [x] XSS sanitisation (xss-clean)
- [x] HTTP parameter pollution protection (hpp)
- [x] Body size limits (1mb)
- [x] **Idempotency keys** on bookings, payments, orders (no double charges)
- [x] **Request-ID tracing** on every request (+ echoed in errors & audit)
- [x] `x-powered-by` disabled
- [x] Payment signature + webhook signature verification (Razorpay)

## Auditability

- [x] Immutable audit log of every mutating request (2-year retention, TTL)
- [x] Login history (1-year retention)
- [x] Admin views for audit logs + login history

## Internationalisation (future-ready)

- [x] Locale resolution (Accept-Language / user pref)
- [x] Multi-currency context (X-Currency header, supported list)
- [x] Timezone + country context per request
- [x] Content-Language response header

## Testing

- [x] Unit tests: encryption, TOTP, JWT
- [x] Integration tests: auth flow, protected routes, error envelope (in-memory Mongo)
- Run: `npm test`

## Before Production — Manual Checklist

- [ ] Replace ALL secrets in `.env` (JWT, cookie, **ENCRYPTION_KEY** as 64-hex)
- [ ] Set `NODE_ENV=production`
- [ ] Use MongoDB Atlas with IP whitelist + strong credentials
- [ ] Enable Redis (for OTP/session/rate-limit at scale)
- [ ] Configure MSG91, Razorpay (+ webhook secret), Cloudinary, Firebase, Agora
- [ ] Set `ADMIN_IP_ALLOWLIST` to your office/VPN IPs
- [ ] Terminate TLS (HTTPS) at the load balancer — never serve plain HTTP
- [ ] Set up Sentry (error tracking) + uptime monitoring
- [ ] Run a dependency audit: `npm audit`
- [ ] Rotate the ENCRYPTION_KEY plan documented (re-encryption migration)
- [ ] Penetration test before international launch

## Money-Flow Integrity (audited & fixed)

- [x] Token / full-online bookings are **not** marked paid at creation — only after `/payments/verify` confirms the Razorpay signature (no phantom money)
- [x] Wallet top-up amount is taken from a **server-side Payment record**, never from the client (no wallet inflation)
- [x] Cancellation refunds follow documented tiers (>4h 100%, 1–4h 50%, <1h none; salon-cancel 100% + goodwill points) and only refund what was actually paid
- [x] Gift vouchers & subscriptions are paid from the (verified) wallet — no unverified payment IDs mint value
- [x] Payment reconciliation is **idempotent** and handled by both `/verify` and the Razorpay webhook (whichever lands first), guarded by `booking.paymentStatus`
- [x] Booking overlap check prevents a stylist being double-booked across a service's full duration
- [x] All date/"today" logic is timezone-aware (Asia/Kolkata by default), not UTC
- [x] Staff get a linked `role:'staff'` User account so chat/call/notifications actually reach the stylist

## Key Rotation Notes

The `ENCRYPTION_KEY` protects bank data. If it must change, run a migration that
decrypts with the old key and re-encrypts with the new one. Never lose the key —
encrypted fields become unreadable without it.

---
© 2026 GlowOra.life
