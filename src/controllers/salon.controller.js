/**
 * Salon controller — public discovery + owner management + admin approval.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const { getPagination, buildMeta } = require('../utils/pagination');
const { uploadImage } = require('../config/cloudinary');
const Salon = require('../models/Salon');
const Service = require('../models/Service');
const Staff = require('../models/Staff');
const ServicePackage = require('../models/ServicePackage');
const Review = require('../models/Review');
const Booking = require('../models/Booking');
const { notifyUser } = require('../services/notification.service');
const { localYmd, localTime, addMinutes, escapeRegex } = require('../utils/helpers');
const { creditWallet } = require('./wallet.controller');
const logger = require('../utils/logger');

// Live "crowd status" — a cheap, informational busy/free signal for salon
// cards (not a precise queue; that's a separate partner-app feature). A
// salon is "busy" if it has >= BUSY_THRESHOLD confirmed/in-progress bookings
// starting today within the next ~2 hours. Batches ONE query across all
// given salon ids (rather than a countDocuments per salon) so this stays
// cheap even for a full page of discovery results.
const BUSY_THRESHOLD = 3;
const BUSY_WINDOW_MINUTES = 120;
async function attachCrowdStatus(salons) {
  if (!salons.length) return salons;
  const today = localYmd();
  const now = localTime();
  const windowEnd = addMinutes(now, BUSY_WINDOW_MINUTES);
  const salonIds = salons.map((s) => s._id);

  const bookings = await Booking.find({
    salon: { $in: salonIds },
    status: { $in: ['confirmed', 'in_progress'] },
    date: today,
    startTime: { $gte: now, $lte: windowEnd },
  }).select('salon');

  const counts = {};
  bookings.forEach((b) => {
    const key = b.salon.toString();
    counts[key] = (counts[key] || 0) + 1;
  });

  // salons may be plain objects (.lean()) or Mongoose docs — plain assignment
  // works for both, and the caller controls whether the response is lean.
  return salons.map((s) => {
    const plain = typeof s.toObject === 'function' ? s.toObject() : s;
    plain.crowdStatus = (counts[s._id.toString()] || 0) >= BUSY_THRESHOLD ? 'busy' : 'free';
    return plain;
  });
}

// A salon only goes live (visible to customers) once its profile is actually
// usable — at least one photo AND at least one service. Until then it stays
// 'pending' regardless of AUTO_APPROVE_SALONS, so nobody sees an empty shell
// of a salon. Call this after anything that could complete the profile
// (photo upload, first service added, salon update).
async function tryActivateSalon(salonId) {
  const salon = await Salon.findById(salonId);
  if (!salon) return salon;
  if (salon.status !== 'pending') return salon;

  const hasPhoto = Boolean(salon.coverImage) || (salon.images || []).length > 0;
  const hasService = await Service.exists({ salon: salonId, active: true });
  if (!hasPhoto || !hasService) return salon;

  const autoApprove = process.env.AUTO_APPROVE_SALONS !== 'false';
  if (!autoApprove) return salon; // still needs manual admin approval

  salon.status = 'active';
  await salon.save();
  return salon;
}
exports.tryActivateSalon = tryActivateSalon;

// Fields returned by the discovery endpoints (getNearby/search). Includes
// openTime/closeTime/weeklyOff so the mobile app can compute "open now"
// client-side without an extra round trip per salon.
const DISCOVERY_SELECT = 'name slug type coverImage address location rating reviewCount offersHomeService isFeatured openTime closeTime weeklyOff';

// Maps the `sort` query param (Explore screen filter sheet) to a Mongo sort.
// 'distance' only makes sense with $near (already distance-sorted by Mongo),
// so it's handled by simply not overriding the default $near ordering.
// NOTE: there is no price field on Salon (price lives per-Service), so
// "sort by price" is intentionally not offered here — it's handled
// client-side in Explore.js using each salon's fetched price range, if any.
function sortFor(sortParam) {
  switch (sortParam) {
    case 'rating': return { rating: -1 };
    default: return { isFeatured: -1, rating: -1 };
  }
}

// GET /api/v1/salons/nearby?lng=&lat=&radius=&city=&type=&minRating=&sort=
// If lng/lat given → geo search within `radius` (default 25km, caller can pass
// a smaller/larger value from the "distance" filter) so salons in nearby
// cities are included too. Otherwise fall back to the given city, and if no
// city either, show all active salons (featured/top-rated first, or per `sort`).
exports.getNearby = asyncHandler(async (req, res) => {
  const { lng, lat, radius = 25000, city, type, category, minRating, sort } = req.query;
  const filter = { status: 'active' };
  if (type) filter.type = type;
  if (minRating) filter.rating = { $gte: parseFloat(minRating) };
  if (category) {
    const salonIds = await Service.find({ category, active: true }).distinct('salon');
    filter._id = { $in: salonIds };
  }

  let query;
  if (lng && lat) {
    // geo radius — automatically spans nearby cities. $near already sorts by
    // distance, so we only apply an explicit .sort() for non-distance options.
    filter.location = {
      $near: {
        $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
        $maxDistance: parseInt(radius, 10),
      },
    };
    query = Salon.find(filter);
    if (sort && sort !== 'distance') query = query.sort(sortFor(sort));
  } else {
    if (city) filter['address.city'] = new RegExp(`^${escapeRegex(city)}$`, 'i');
    query = Salon.find(filter).sort(sortFor(sort));
  }

  const salons = await query.limit(50).select(DISCOVERY_SELECT);
  const withCrowdStatus = await attachCrowdStatus(salons);
  sendResponse(res, 200, 'Nearby salons', { count: withCrowdStatus.length, salons: withCrowdStatus });
});

// GET /api/v1/salons/search?q=&city=&category=&page=&minRating=&sort=
exports.search = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = { status: 'active' };
  if (req.query.city) filter['address.city'] = new RegExp(`^${escapeRegex(req.query.city)}$`, 'i');
  if (req.query.type) filter.type = req.query.type;
  if (req.query.q) filter.name = new RegExp(escapeRegex(req.query.q), 'i');
  if (req.query.minRating) filter.rating = { $gte: parseFloat(req.query.minRating) };
  if (req.query.category) {
    // Category filters by service, not by a field on Salon itself — find
    // salons that actually offer an active service in this category
    // (same approach as the `nearby` endpoint above).
    const salonIds = await Service.find({ category: req.query.category, active: true }).distinct('salon');
    filter._id = { $in: salonIds };
  }

  const [salons, total] = await Promise.all([
    Salon.find(filter).sort(sortFor(req.query.sort)).skip(skip).limit(limit)
      .select(DISCOVERY_SELECT),
    Salon.countDocuments(filter),
  ]);
  const withCrowdStatus = await attachCrowdStatus(salons);
  sendResponse(res, 200, 'Search results', { salons: withCrowdStatus }, buildMeta(page, limit, total));
});

// GET /api/v1/salons/:id  (full detail with services + staff + packages)
exports.getById = asyncHandler(async (req, res) => {
  // Exclude the salon-to-salon referral fields — this endpoint is hit by
  // anyone (customers via the public salon page, partner apps checking a
  // salon's detail) and unlike getNearby/search (which already restrict to
  // DISCOVERY_SELECT), it had no field restriction at all, so `referredBy`/
  // `referralRewarded` — an owner-only business relationship, already
  // correctly scoped to owners-only in the dedicated referrals() endpoint —
  // was leaking to anyone who hit this URL.
  const salon = await Salon.findById(req.params.id).select('-referredBy -referralRewarded').populate('owner', 'name');
  if (!salon || salon.status !== 'active') throw ApiError.notFound('Salon not found');

  const [services, staff, packages, reviews, [salonWithCrowdStatus]] = await Promise.all([
    Service.find({ salon: salon._id, active: true }),
    Staff.find({ salon: salon._id, active: true }).select('name avatar specialities rating status portfolio'),
    // .populate('services') is required — ServicePackage.services is just an
    // array of ObjectIds; without this, the customer app would render raw
    // id strings where it expects {name, price} objects.
    ServicePackage.find({ salon: salon._id, active: true }).populate('services'),
    Review.find({ salon: salon._id }).populate('customer', 'name avatar').sort({ createdAt: -1 }).limit(10),
    attachCrowdStatus([salon]),
  ]);

  sendResponse(res, 200, 'Salon detail', { salon: salonWithCrowdStatus, services, staff, packages, reviews });
});

// POST /api/v1/salons/:id/images   (owner, multipart: images[])
exports.uploadImages = asyncHandler(async (req, res) => {
  const salon = await Salon.findById(req.params.id);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw ApiError.forbidden('Not your salon');
  }
  if (!req.files || !req.files.length) throw ApiError.badRequest('No images uploaded');
  const uploaded = await Promise.all(req.files.map((f) => uploadImage(f.buffer, 'glowora/salons')));
  const urls = uploaded.map((u) => u.url);
  if (!salon.coverImage && urls.length) salon.coverImage = urls[0];
  salon.images.push(...urls);
  await salon.save();
  const updated = await tryActivateSalon(salon._id);
  sendResponse(res, 200, 'Images uploaded', { images: updated.images, salonStatus: updated.status });
});

// POST /api/v1/salons  (owner registers a salon)
// Always starts 'pending' — a brand-new salon has no photos/services yet, so
// there's nothing worth showing customers. It flips to 'active' automatically
// (see tryActivateSalon) once the owner adds at least one photo and one
// service — no admin wait, but also no empty salons in search results.
exports.create = asyncHandler(async (req, res) => {
  const { name, type, description, address, location, offersHomeService, openTime, closeTime, referralCode } = req.body;
  if (!name || !type || !address?.city || !location?.coordinates) {
    throw ApiError.badRequest('name, type, address.city and location.coordinates are required');
  }
  // Salon-to-salon referral — if this new owner entered another salon's
  // referral code, link them. The reward isn't credited yet: see
  // booking.controller.js updateStatus, which pays out only once THIS new
  // salon completes its first real booking (prevents fake-salon farming).
  // Deliberately ignore a code that resolves to a salon the SAME owner
  // already runs — otherwise a multi-branch owner could refer their own new
  // branch to themselves, then trivially trigger "first completed booking"
  // via walkIn() with a ₹0 service, farming config.salonReferralBonus with
  // zero real economic activity (repeatable across up to 10 salons/owner).
  let referredBy;
  if (referralCode && typeof referralCode === 'string' && referralCode.trim()) {
    const referrer = await Salon.findOne({ referralCode: referralCode.trim().toUpperCase() }).select('_id owner');
    if (referrer && referrer.owner.toString() !== req.user._id.toString()) referredBy = referrer._id;
  }
  // Multi-branch support: owners can register more than one salon (e.g. a
  // second location in another area). We only apply a generous soft cap —
  // not a hard "one salon per owner" block — as a sanity limit against
  // runaway duplicate creation (accidental double-taps, abuse), not against
  // legitimate multi-branch owners. The mobile app's authStore now tracks
  // ALL of an owner's salons (not just salons[0]) and lets them switch the
  // active one, so duplicates are no longer silently confusing — see
  // authStore.js's `salons`/`setActiveSalon`.
  const existingCount = await Salon.countDocuments({ owner: req.user._id, status: { $ne: 'rejected' } });
  const MAX_BRANCHES_PER_OWNER = 10;
  if (existingCount >= MAX_BRANCHES_PER_OWNER) {
    throw ApiError.badRequest(`You've reached the maximum of ${MAX_BRANCHES_PER_OWNER} salons per account. Contact support if you need more.`);
  }
  const salon = await Salon.create({
    owner: req.user._id,
    name, type, description, address, location,
    offersHomeService, openTime, closeTime,
    status: 'pending',
    referredBy,
  });
  sendResponse(res, 201, 'Salon created — add photos and a service to go live', { salon });
});

// GET /api/v1/salons/mine  (owner's salons — full list, multi-branch aware)
// Also self-heals: catches salons that already meet the go-live criteria
// (e.g. photos/services were added before this activation check existed, or
// before an admin-approval-only deploy) but never got flipped to 'active'.
exports.getMine = asyncHandler(async (req, res) => {
  // Sorted newest-first. The mobile authStore keeps the FULL array (`salons`)
  // and separately tracks which one is "active" (persisted per-device), so
  // this ordering is just a sensible default for first-ever login — it's no
  // longer relied on to hide extra salons the way a plain `salons[0]` read
  // used to.
  // This is the owner's OWN data, so unlike the public getById endpoint,
  // explicitly opt back into the select:false bank/PAN/GST fields (Salon.js)
  // — otherwise the partner app's BankDetails screen can never prefill what
  // the owner already saved.
  const BANK_SELECT = '+bankDetails +panNumber +gstNumber';
  let salons = await Salon.find({ owner: req.user._id }).select(BANK_SELECT).sort({ createdAt: -1 });
  const pending = salons.filter((s) => s.status === 'pending');
  if (pending.length) {
    await Promise.all(pending.map((s) => tryActivateSalon(s._id)));
    salons = await Salon.find({ owner: req.user._id }).select(BANK_SELECT).sort({ createdAt: -1 });
  }
  sendResponse(res, 200, 'Your salons', { count: salons.length, salons });
});

// PATCH /api/v1/salons/:id  (owner updates own salon)
exports.update = asyncHandler(async (req, res) => {
  const salon = await Salon.findById(req.params.id);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw ApiError.forbidden('You can only edit your own salon');
  }
  const allowed = ['name', 'type', 'description', 'coverImage', 'images', 'offersHomeService', 'homeServiceRadius', 'openTime', 'closeTime', 'weeklyOff', 'workingHours', 'breakStart', 'breakEnd', 'maxPerSlot', 'address', 'location'];
  allowed.forEach((k) => { if (req.body[k] !== undefined) salon[k] = req.body[k]; });
  await salon.save();
  sendResponse(res, 200, 'Salon updated', { salon });
});

// PATCH /api/v1/salons/:id/bank  { bankDetails, gstNumber, panNumber }  (owner)
exports.updateBank = asyncHandler(async (req, res) => {
  const salon = await Salon.findById(req.params.id);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw ApiError.forbidden('Not your salon');
  }
  if (req.body.bankDetails) { salon.bankDetails = req.body.bankDetails; salon.bankVerified = false; }
  if (req.body.gstNumber !== undefined) salon.gstNumber = req.body.gstNumber;
  if (req.body.panNumber !== undefined) salon.panNumber = req.body.panNumber;
  await salon.save();
  sendResponse(res, 200, 'Bank & tax details updated', { salon });
});

// PATCH /api/v1/salons/:id/verify-bank  { verified: true|false }  (admin)
// No real bank-API (penny-drop) integration yet — admin manually checks the
// account details and flips this flag. Only bankVerified salons are picked
// up by the T+1 auto-settlement job (scheduler.service.js `runWalletSettlement`).
exports.verifyBank = asyncHandler(async (req, res) => {
  const salon = await Salon.findByIdAndUpdate(
    req.params.id,
    { bankVerified: req.body.verified !== false },
    { new: true }
  ).select('+bankDetails name bankVerified');
  if (!salon) throw ApiError.notFound('Salon not found');
  sendResponse(res, 200, `Bank account ${salon.bankVerified ? 'verified' : 'unverified'}`, { salon });
});

// GET /api/v1/salons/admin/pending-bank  (admin) — salons that have submitted
// bank details but aren't verified yet, for the admin bank-verification queue.
exports.pendingBankVerification = asyncHandler(async (req, res) => {
  const salons = await Salon.find({
    'bankDetails.accountNumber': { $exists: true, $ne: null, $nin: ['', null] },
    bankVerified: false,
  })
    .select('+bankDetails +gstNumber +panNumber name bankVerified owner')
    .populate('owner', 'name phone')
    .sort({ updatedAt: -1 })
    .limit(500); // safety cap — this is an admin review queue, not meant to grow unbounded
  sendResponse(res, 200, 'Salons pending bank verification', { salons });
});

// ---- Admin ----
// GET /api/v1/salons/admin/all?status=
exports.adminList = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const salons = await Salon.find(filter).populate('owner', 'name phone').sort({ createdAt: -1 });
  sendResponse(res, 200, 'All salons', { count: salons.length, salons });
});

// PATCH /api/v1/salons/:id/status  { status, rejectionReason? }  (admin)
exports.setStatus = asyncHandler(async (req, res) => {
  const { status, rejectionReason } = req.body;
  if (!['active', 'rejected', 'suspended', 'pending'].includes(status)) {
    throw ApiError.badRequest('Invalid status');
  }
  const salon = await Salon.findByIdAndUpdate(
    req.params.id,
    { status, rejectionReason: status === 'rejected' ? rejectionReason : undefined },
    { new: true }
  );
  if (!salon) throw ApiError.notFound('Salon not found');

  // Deactivating a salon (anything other than 'active') must not leave
  // customers with pending/confirmed bookings that now point at a salon
  // that can no longer serve them — auto-cancel + notify + refund, same as
  // a normal cancellation (see booking.controller.js's cancel()).
  if (status !== 'active') {
    const affectedBookings = await Booking.find({
      salon: salon._id,
      status: { $in: ['pending', 'confirmed'] },
      date: { $gte: localYmd() },
    });

    for (const booking of affectedBookings) {
      booking.status = 'cancelled';
      booking.cancelledBy = 'system';
      booking.cancelReason = 'Salon deactivated by admin';
      booking.communicationUnlocked = false;
      await booking.save();

      // NOTE: booking.controller.js's cancel() has real Razorpay-refund logic
      // (refunds to the original payment method first, falling back to
      // wallet credit). Reusing that here safely would need extracting it
      // into a shared helper, which is out of scope for this admin-triggered
      // path — as a minimum-bar fallback we credit the paid amount straight
      // to the customer's wallet so no refund is silently lost.
      if (booking.amountPaid > 0) {
        try {
          await creditWallet(
            booking.customer,
            booking.amountPaid,
            'refund',
            `Refund for booking ${booking.bookingCode} — salon deactivated by admin`,
            booking._id
          );
        } catch (e) {
          logger.error(`Wallet credit failed for booking ${booking.bookingCode} on salon deactivation: ${e.message}`);
        }
      }

      notifyUser(booking.customer, {
        title: 'Booking cancelled',
        body: `Your booking at ${salon.name} was cancelled because the salon is no longer active. Any amount paid will be refunded to your wallet.`,
        type: 'booking',
        data: { bookingId: booking._id.toString() },
      });
    }
  }

  sendResponse(res, 200, `Salon ${status}`, { salon });
});

// PATCH /api/v1/salons/:id/feature  (admin toggle)
exports.toggleFeature = asyncHandler(async (req, res) => {
  const salon = await Salon.findById(req.params.id);
  if (!salon) throw ApiError.notFound('Salon not found');
  salon.isFeatured = !salon.isFeatured;
  await salon.save();
  sendResponse(res, 200, salon.isFeatured ? 'Salon featured' : 'Salon unfeatured', { salon });
});

// POST /api/v1/salons/:id/broadcast  { title, body }  (owner of this salon)
// Salon-scoped version of admin.controller.js's platform-wide broadcast — the
// owner messages only their OWN past customers, found via distinct customer
// ids on this salon's bookings. That audience is expected to be small (a
// single salon's customer base, not the whole platform), so a plain
// Promise.all of notifyUser calls is fine here — no need for the batched
// queue-based `broadcast()` helper admin uses for platform-wide sends.
exports.broadcast = asyncHandler(async (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) throw ApiError.badRequest('title and body are required');

  const salon = await Salon.findById(req.params.id);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw ApiError.forbidden('Not your salon');
  }

  const customerIds = await Booking.find({ salon: salon._id }).distinct('customer');
  // notifyUser is fire-and-forget by design (enqueues and returns immediately —
  // see notification.service.js) so we don't await it here, same as every
  // other notifyUser call site in the codebase (e.g. booking.controller.js).
  customerIds.forEach((customerId) => {
    notifyUser(customerId, { title, body, type: 'promo', data: { salonId: salon._id.toString() } });
  });
  sendResponse(res, 200, 'Message sent to your customers', { recipients: customerIds.length });
});

// POST /api/v1/salons/:id/win-back  { customerIds: [...], title, body }  (owner of this salon)
// Targeted version of broadcast() above — instead of messaging ALL past
// customers, the owner picks specific (usually dormant/inactive) customers
// from analytics.controller.js's dormantCustomers list and sends them a
// win-back nudge. customerIds is intersected against this salon's actual
// past customers so an owner can't be tricked into spamming arbitrary users.
exports.winBack = asyncHandler(async (req, res) => {
  const { customerIds, title, body } = req.body;
  if (!title || !body) throw ApiError.badRequest('title and body are required');
  if (!Array.isArray(customerIds) || customerIds.length === 0) {
    throw ApiError.badRequest('customerIds must be a non-empty array');
  }

  const salon = await Salon.findById(req.params.id);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw ApiError.forbidden('Not your salon');
  }

  const validCustomerIds = await Booking.find({
    salon: salon._id, customer: { $in: customerIds },
  }).distinct('customer');

  validCustomerIds.forEach((customerId) => {
    notifyUser(customerId, { title, body, type: 'promo', data: { salonId: salon._id.toString(), winBack: true } });
  });

  sendResponse(res, 200, 'Win-back message sent', { recipients: validCustomerIds.length });
});

// GET /api/v1/salons/:id/referrals  (owner of this salon)
// This salon's own shareable referral code, plus every salon that signed up
// using it — with whether each one has already triggered the reward
// (referralRewarded flips true on their first completed booking, see
// booking.controller.js updateStatus).
exports.referrals = asyncHandler(async (req, res) => {
  const salon = await Salon.findById(req.params.id).select('owner referralCode');
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw ApiError.forbidden('Not your salon');
  }

  const referred = await Salon.find({ referredBy: salon._id })
    .select('name status createdAt referralRewarded')
    .sort({ createdAt: -1 });

  sendResponse(res, 200, 'Referrals', {
    referralCode: salon.referralCode,
    referred: referred.map((s) => ({
      _id: s._id, name: s.name, status: s.status,
      joinedAt: s.createdAt, rewarded: s.referralRewarded,
    })),
    rewardedCount: referred.filter((s) => s.referralRewarded).length,
  });
});
