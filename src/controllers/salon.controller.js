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

// A salon only goes live (visible to customers) once its profile is actually
// usable — at least one photo AND at least one service. Until then it stays
// 'pending' regardless of AUTO_APPROVE_SALONS, so nobody sees an empty shell
// of a salon. Call this after anything that could complete the profile
// (photo upload, first service added, salon update).
async function tryActivateSalon(salonId) {
  const salon = await Salon.findById(salonId);
  if (!salon) { console.log('[tryActivateSalon]', salonId, 'no salon found'); return salon; }
  if (salon.status !== 'pending') {
    console.log('[tryActivateSalon]', salon._id.toString(), 'status is', salon.status, '- skipping');
    return salon;
  }

  const hasPhoto = Boolean(salon.coverImage) || (salon.images || []).length > 0;
  const hasService = await Service.exists({ salon: salonId, active: true });
  console.log('[tryActivateSalon]', salon._id.toString(), { hasPhoto, coverImage: salon.coverImage, imagesLen: (salon.images || []).length, hasService: Boolean(hasService), autoApproveEnv: process.env.AUTO_APPROVE_SALONS });
  if (!hasPhoto || !hasService) return salon;

  const autoApprove = process.env.AUTO_APPROVE_SALONS !== 'false';
  if (!autoApprove) { console.log('[tryActivateSalon]', salon._id.toString(), 'auto-approve disabled, needs manual approval'); return salon; }

  salon.status = 'active';
  await salon.save();
  console.log('[tryActivateSalon]', salon._id.toString(), 'ACTIVATED');
  return salon;
}
exports.tryActivateSalon = tryActivateSalon;

// GET /api/v1/salons/nearby?lng=&lat=&radius=&city=&type=
// If lng/lat given → geo search within `radius` (default 25km) so salons in
// nearby cities are included too. Otherwise fall back to the given city, and if
// no city either, show all active salons (featured/top-rated first).
exports.getNearby = asyncHandler(async (req, res) => {
  const { lng, lat, radius = 25000, city, type } = req.query;
  const filter = { status: 'active' };
  if (type) filter.type = type;

  let query;
  if (lng && lat) {
    // geo radius — automatically spans nearby cities
    filter.location = {
      $near: {
        $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
        $maxDistance: parseInt(radius, 10),
      },
    };
    query = Salon.find(filter);
  } else {
    if (city) filter['address.city'] = new RegExp(`^${city}$`, 'i');
    query = Salon.find(filter).sort({ isFeatured: -1, rating: -1 });
  }

  const salons = await query.limit(50).select('name slug type coverImage address location rating reviewCount offersHomeService isFeatured');
  sendResponse(res, 200, 'Nearby salons', { count: salons.length, salons });
});

// GET /api/v1/salons/search?q=&city=&category=&page=
exports.search = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = { status: 'active' };
  if (req.query.city) filter['address.city'] = new RegExp(`^${req.query.city}$`, 'i');
  if (req.query.type) filter.type = req.query.type;
  if (req.query.q) filter.name = new RegExp(req.query.q, 'i');

  const [salons, total] = await Promise.all([
    Salon.find(filter).sort({ isFeatured: -1, rating: -1 }).skip(skip).limit(limit)
      .select('name slug type coverImage address location rating reviewCount offersHomeService isFeatured'),
    Salon.countDocuments(filter),
  ]);
  sendResponse(res, 200, 'Search results', { salons }, buildMeta(page, limit, total));
});

// GET /api/v1/salons/:id  (full detail with services + staff + packages)
exports.getById = asyncHandler(async (req, res) => {
  const salon = await Salon.findById(req.params.id).populate('owner', 'name');
  if (!salon || salon.status !== 'active') throw ApiError.notFound('Salon not found');

  const [services, staff, packages, reviews] = await Promise.all([
    Service.find({ salon: salon._id, active: true }),
    Staff.find({ salon: salon._id, active: true }).select('name avatar specialities rating status'),
    ServicePackage.find({ salon: salon._id, active: true }),
    Review.find({ salon: salon._id }).populate('customer', 'name avatar').sort({ createdAt: -1 }).limit(10),
  ]);

  sendResponse(res, 200, 'Salon detail', { salon, services, staff, packages, reviews });
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
  const { name, type, description, address, location, offersHomeService, openTime, closeTime } = req.body;
  if (!name || !type || !address?.city || !location?.coordinates) {
    throw ApiError.badRequest('name, type, address.city and location.coordinates are required');
  }
  // One salon per owner. Without this, repeated taps on "create salon" (or
  // testing) silently create duplicates — since every other screen assumes
  // a single salon (`salons[0]`), the wrong (often incomplete) one can end
  // up "winning" and the real one never appears to go live.
  const existing = await Salon.findOne({ owner: req.user._id, status: { $ne: 'rejected' } });
  if (existing) {
    throw ApiError.badRequest('You already have a salon registered. Edit your existing salon instead of creating a new one.');
  }
  const salon = await Salon.create({
    owner: req.user._id,
    name, type, description, address, location,
    offersHomeService, openTime, closeTime,
    status: 'pending',
  });
  sendResponse(res, 201, 'Salon created — add photos and a service to go live', { salon });
});

// GET /api/v1/salons/mine  (owner's salons)
// Also self-heals: catches salons that already meet the go-live criteria
// (e.g. photos/services were added before this activation check existed, or
// before an admin-approval-only deploy) but never got flipped to 'active'.
exports.getMine = asyncHandler(async (req, res) => {
  // Sorted newest-first: the app (and mobile authStore) always takes
  // salons[0] as "the" salon. If duplicate salons exist from earlier
  // testing, this ensures the most recently created one (almost always the
  // real/complete one) is what's shown, not whichever old doc Mongo
  // happens to return first.
  let salons = await Salon.find({ owner: req.user._id }).sort({ createdAt: -1 });
  const pending = salons.filter((s) => s.status === 'pending');
  if (pending.length) {
    await Promise.all(pending.map((s) => tryActivateSalon(s._id)));
    salons = await Salon.find({ owner: req.user._id }).sort({ createdAt: -1 });
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
  const allowed = ['name', 'description', 'coverImage', 'images', 'offersHomeService', 'homeServiceRadius', 'openTime', 'closeTime', 'weeklyOff', 'workingHours', 'breakStart', 'breakEnd', 'maxPerSlot', 'address', 'location'];
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
  if (req.body.bankDetails) salon.bankDetails = req.body.bankDetails;
  if (req.body.gstNumber !== undefined) salon.gstNumber = req.body.gstNumber;
  if (req.body.panNumber !== undefined) salon.panNumber = req.body.panNumber;
  await salon.save();
  sendResponse(res, 200, 'Bank & tax details updated', { salon });
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
