# GlowOra Backend API

Complete Node.js + Express + MongoDB backend powering the GlowOra beauty super app — customer app, partner app, admin panel, and GlowOra Shop all talk to this single API.

**200+ endpoints across 38 modules · 40 data models.** Built to enterprise / international standards: TOTP 2FA, session & device management with refresh-token reuse detection, AES-256 field encryption, immutable audit logs, GDPR/DPDP data export & erasure, idempotency keys, request tracing, i18n/multi-currency, strict CSP/HSTS, plus OTP + password auth, Razorpay payments, real-time chat, in-app calls, push notifications, subscriptions, gift vouchers, salon analytics, waitlists, recurring bookings, inventory, marketing campaigns, AI recommendations/analysis, and a full e-commerce shop.

> **Interactive API docs:** `GET /api/v1/docs` (Swagger UI) · spec at `/api/v1/docs.json`
> See **SECURITY.md** for the complete security & compliance checklist.
> See **SCALING.md** for the 1M+ users deployment playbook.
> Run `npm test` for the automated test suite (encryption, TOTP, JWT, auth integration).

## Built to scale (horizontal)

- **PM2 cluster mode** (`npm run start:cluster`) — one Node process per CPU core.
- **BullMQ job queue** — notifications/broadcasts run in a background worker, so APIs stay fast under load (inline fallback in dev).
- **Socket.IO Redis adapter** — chat works across many servers behind a load balancer.
- **gzip compression**, tuned Mongo connection pool, pagination everywhere.
- Stateless + JWT → add more servers to handle more traffic. Load-test with `npm run loadtest` (k6).

## New in this build

- **Waitlist** `/waitlist` — join a busy day; auto-notified when a slot frees (hooked into cancellations)
- **Recurring bookings** `/recurring` — standing appointments (weekly/biweekly/monthly)
- **Inventory** `/inventory` — salon stock with low-stock alerts
- **Marketing campaigns** `/campaigns` — segment customers (inactive/new/high-value) and blast offers
- **AI / smart features** `/ai` — personalised recommendations, "customers also booked", rule-based face/hair guidance (vision-model ready), demand forecasting, FAQ assistant
- **API docs** `/docs` — Swagger UI + OpenAPI 3 spec

## Scheduler (background jobs)

Started automatically in `server.js` via `node-cron`:

- **Appointment reminders** (every 5 min) — notifies customer + assigned staff ~1 hour before the slot (`reminderSent` guard prevents duplicates)
- **Recurring bookings** (hourly) — materialises due `RecurringBooking`s into real bookings + reserves the slot
- **Expiry sweep** (daily 02:00) — expires subscriptions, downgrades lapsed salon plans to Free, un-features expired salons, expires stale waitlist entries

## Documented business rules — now fully wired

- **Loyalty:** earn on completion **and redeem** at booking (`redeemPoints` in booking body; 10 pts = ₹1)
- **Tiered commission:** by salon plan (Free 15% / Basic 12% / Pro 10%) and pay-at-salon capped at 5% — computed per booking, not a flat rate
- **Shop seller types:** products carry `sellerType` (glowora / salon / brand) with per-type `commissionPercent`
- **Smart product nudge:** stylist records `productsUsed` on completion → customer gets a "take it home" Shop notification
- **Offer-nearby push:** creating a salon offer notifies that salon's past customers

## Tech Stack

- **Runtime:** Node.js + Express
- **Database:** MongoDB (Mongoose) — 25 models
- **Cache/OTP:** Redis (with in-memory dev fallback)
- **Auth:** JWT access + refresh (rotation) · OTP via MSG91 · password login for owner/admin · account lockout
- **Payments:** Razorpay (order + verify + webhook + refund)
- **Realtime:** Socket.io chat · Agora call tokens
- **Push:** Firebase Cloud Messaging
- **Uploads:** Cloudinary (multer memory storage)
- **Security:** helmet, cors (whitelist), express-rate-limit, mongo-sanitize, xss-clean, hpp, bcrypt, cookie-parser

> Every third-party integration **degrades gracefully in dev** — without keys, OTP prints to console, payments/uploads/calls/push run in mock mode. So you can run the whole thing with just MongoDB.

## Getting Started

```bash
npm install
cp .env.example .env      # already created for you with your local Mongo URL
npm run dev               # http://localhost:5000
```

Requires **MongoDB running** at `mongodb://localhost:27017/glowora` (your URL is already set in `.env`).
Redis is optional in dev.

On first start, a **super admin** is auto-seeded:
`phone: 9999999999` · `password: Admin@123` (change in `.env`).

- Health: `GET /health`
- API index: `GET /api/v1`

## Project Structure

```
glowora-backend/
├── server.js                 # entry: DB + Redis + Socket + seed
├── src/
│   ├── app.js                # express app + security middleware
│   ├── config/               # env, db, redis, razorpay, cloudinary, agora, firebase
│   ├── models/               # 25 Mongoose schemas
│   ├── controllers/          # 25 controllers
│   ├── routes/               # 23 route files + index
│   ├── middleware/           # auth, error, rate-limit, validate, upload
│   ├── services/             # notification service (feed + push)
│   ├── socket/               # Socket.io realtime chat
│   └── utils/                # jwt, otp, password, pagination, logger, helpers, seedAdmin
```

## Auth

Bearer header: `Authorization: Bearer <accessToken>`
Access tokens last 15 min; refresh via `/auth/refresh` (tokens rotate).

## API Reference — base `/api/v1`

### Auth `/auth`
`POST /send-otp` · `POST /verify-otp` · `POST /login` (password) · `POST /forgot-password` · `POST /reset-password` · `POST /refresh` · `POST /set-password` · `POST /logout` · `POST /fcm-token` · `GET /me`

### Users `/users`
`GET /profile` · `PATCH /profile` · `POST /avatar` · `GET /wallet` · `DELETE /me` · `GET /` (admin) · `PATCH /:id/block` (admin) · `POST /:id/wallet-adjust` (admin)

### Addresses `/addresses`
`GET /` · `POST /` · `PATCH /:id` · `DELETE /:id`

### Salons `/salons`
`GET /nearby` · `GET /search` · `GET /:id` · `POST /` (owner) · `GET /mine` (owner) · `PATCH /:id` (owner) · `POST /:id/images` (owner) · `GET /admin/all` (admin) · `PATCH /:id/status` (admin) · `PATCH /:id/feature` (admin)

### Services `/services`
`GET /` · `POST /` (owner) · `PATCH /:id` (owner) · `DELETE /:id` (owner)

### Packages `/packages`
`GET /` · `POST /` (owner) · `PATCH /:id` (owner) · `DELETE /:id` (owner)

### Staff `/staff`
`GET /` · `POST /` (owner) · `PATCH /:id` (owner/staff) · `DELETE /:id` (owner)

### Attendance `/attendance`
`GET /` · `POST /` · `GET /earnings`  (owner/staff)

### Bookings `/bookings`
`GET /availability` · `POST /` (customer) · `GET /mine` · `GET /salon/:salonId` (owner) · `PATCH /:id/status` (owner) · `PATCH /:id/reschedule` (customer) · `PATCH /:id/cancel`

### Payments `/payments`
`POST /create-order` · `POST /verify` · `POST /webhook` · `GET /mine`

### Wallet `/wallet`
`GET /` · `GET /transactions` · `POST /topup/create-order` · `POST /topup/verify`

### Coupons `/coupons`
`GET /` · `POST /validate` · `POST /` (admin) · `GET /admin/all` (admin) · `PATCH /:id` (admin) · `DELETE /:id` (admin)

### Reviews `/reviews`
`GET /` · `POST /` (customer) · `PATCH /:id/reply` (owner)

### Favorites `/favorites`
`GET /` · `POST /` · `DELETE /:salonId`

### Notifications `/notifications`
`GET /` · `PATCH /read-all` · `PATCH /:id/read`

### Chat `/chat`  (+ Socket.io realtime)
`GET /conversations` · `POST /conversations` · `GET /conversations/:id/messages` · `POST /conversations/:id/messages`
Socket events: `conversation:join`, `message:send`, `message:new`, `typing`, `message:read`

### Calls `/calls`
`POST /token` — Agora RTC token (numbers stay private)

### Cities `/cities`
`GET /` · `POST /` (admin) · `PATCH /:id` (admin) · `DELETE /:id` (admin)

### Banners `/banners`
`GET /` · `POST /` (admin) · `PATCH /:id` (admin) · `DELETE /:id` (admin)

### Support `/support`
`POST /` · `GET /mine` · `GET /:id` · `POST /:id/reply` · `GET /admin/all` (admin) · `PATCH /:id/status` (admin)

### Payouts `/payouts`
`GET /mine` (owner) · `GET /pending` (admin) · `GET /` (admin) · `POST /` (admin)

### Admin `/admin`
`GET /stats` · `GET /reports/bookings-trend` · `GET /reports/bookings-by-city` · `GET /reports/summary` · `POST /broadcast`

### GlowOra Shop `/shop`
Categories: `GET /categories` · `POST /categories` (admin) · `PATCH /categories/:id` (admin)
Products: `GET /products` · `GET /products/:id` · `POST /products` (admin) · `PATCH /products/:id` (admin) · `DELETE /products/:id` (admin)
Cart: `GET /cart` · `POST /cart` · `PATCH /cart` · `DELETE /cart`
Orders: `POST /orders` · `GET /orders/mine` · `GET /orders/:id` · `POST /orders/:id/verify-payment` · `PATCH /orders/:id/cancel` · `GET /orders` (admin) · `PATCH /orders/:id/status` (admin)

### Family `/family`
`GET /` · `POST /` · `PATCH /:id` · `DELETE /:id` — book for family members (up to 6)

### Slots `/slots`  (owner/staff)
`GET /` · `POST /generate` (auto-create day) · `POST /holiday` (block day) · `POST /block` (toggle single slot)

### Extra Booking actions `/bookings`
`POST /walkin` (owner records offline customer) · `POST /:id/home-otp` (customer) · `POST /:id/verify-home-otp` (staff arrival) · `POST /:id/tip` (customer)

### Subscriptions `/subscriptions`
`GET /plans` · `GET /mine` · `POST /salon/subscribe` (owner) · `POST /pass/buy` (customer Glow Pass) · `PATCH /:id/cancel` · `POST /plans` (admin) · `PATCH /plans/:id` (admin)

### Gift Vouchers `/vouchers`
`GET /mine` · `POST /buy` · `POST /redeem` (adds to wallet)

### Salon Offers `/offers`
`GET /?salon=` · `POST /` (owner happy-hours/discounts) · `PATCH /:id` · `DELETE /:id` · `POST /:salonId/feature` (buy featured listing)

### Analytics `/analytics`  (owner)
`GET /invoice/:bookingId` · `GET /:salonId/dashboard` · `GET /:salonId/popular-services` · `GET /:salonId/peak-hours` · `GET /:salonId/retention` · `GET /:salonId/staff-performance` · `GET /:salonId/revenue-trend`

### Product Reviews `/product-reviews`
`GET /?product=` · `POST /` (verified-purchase check) · `DELETE /:id`

### Salon bank/tax `/salons/:id/bank`  (owner)
`PATCH` — bank details, GST, PAN for payouts & invoices

### Admin extras
`GET /admin/reports/export/bookings.csv` — CSV export

## Business Rules

- **Commission:** flat 12% (configurable) — computed per booking
- **Token:** ₹49 to hold a slot; rest at salon
- **Online discount:** 5% for full online payment
- **Loyalty:** 0.1 Glow Point per ₹ on completed bookings
- **Referral:** ₹50 wallet bonus to referrer
- **Chat/Call:** unlocked only between booking confirmation and completion; phone numbers never exposed
- **Refunds:** cancelled paid bookings are refunded to the in-app wallet
- **Free shipping** on shop orders above ₹499
- **Salon plans:** Free (15% commission), Basic ₹499/mo (12%), Pro ₹1999/mo (10% + featured)
- **Customer Glow Pass:** ₹999/mo — included services + member discounts
- **Gift vouchers:** buy for anyone, redeemable to wallet, 1-year validity
- **Home service:** customer generates an arrival OTP; stylist verifies on reaching
- **Walk-ins:** salons record offline customers so earnings & analytics stay accurate

## Security Highlights

- OTP: cryptographically random, Redis-stored, 5-min TTL, resend cooldown, max-attempt lock
- Password: bcrypt (12 rounds), strength check, account lockout after 5 failed logins
- JWT refresh rotation + server-side revocation
- Role-based access control (`customer` / `owner` / `staff` / `admin`)
- Razorpay webhook + payment signature verification
- Input sanitisation (NoSQL injection + XSS + HTTP param pollution), rate limiting, CORS whitelist

---
© 2026 GlowOra.life
