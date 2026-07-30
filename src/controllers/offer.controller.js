/**
 * Offer controller — salon-created discounts & happy hours.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const Offer = require('../models/Offer');
const Salon = require('../models/Salon');
const Booking = require('../models/Booking');
const { notifyUser } = require('../services/notification.service');

async function assertOwns(user, salonId) {
  const salon = await Salon.findById(salonId);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== user._id.toString() && user.role !== 'admin') {
    throw ApiError.forbidden('Not your salon');
  }
  return salon;
}

// GET /offers?salon=  (public)
exports.list = asyncHandler(async (req, res) => {
  if (!req.query.salon) throw ApiError.badRequest('salon query param required');
  const offers = await Offer.find({ salon: req.query.salon, active: true, validUntil: { $gte: new Date() } });
  sendResponse(res, 200, 'Offers', { offers });
});

// POST /offers  (owner)
exports.create = asyncHandler(async (req, res) => {
  const { salon, title, discountType, discountValue, validUntil } = req.body;
  if (!salon || !title || !discountType || discountValue == null || !validUntil) {
    throw ApiError.badRequest('salon, title, discountType, discountValue and validUntil are required');
  }
  const salonDoc = await assertOwns(req.user, salon);
  const offer = await Offer.create(req.body);

  // notify past customers of this salon about the new offer ("offer nearby")
  try {
    const customerIds = await Booking.distinct('customer', { salon });
    const label = discountType === 'percent' ? `${discountValue}% off` : `₹${discountValue} off`;
    for (const uid of customerIds.slice(0, 500)) {
      notifyUser(uid, {
        title: `New offer at ${salonDoc.name} 🎉`,
        body: `${title} — ${label}. Book now to save!`,
        type: 'promo', data: { salonId: salon.toString(), offerId: offer._id.toString() },
      });
    }
  } catch { /* non-fatal */ }

  sendResponse(res, 201, 'Offer created', { offer });
});

// PATCH /offers/:id  (owner)
exports.update = asyncHandler(async (req, res) => {
  const offer = await Offer.findById(req.params.id);
  if (!offer) throw ApiError.notFound('Offer not found');
  await assertOwns(req.user, offer.salon);
  Object.assign(offer, req.body);
  await offer.save();
  sendResponse(res, 200, 'Offer updated', { offer });
});

// DELETE /offers/:id  (owner)
exports.remove = asyncHandler(async (req, res) => {
  const offer = await Offer.findById(req.params.id);
  if (!offer) throw ApiError.notFound('Offer not found');
  await assertOwns(req.user, offer.salon);
  offer.active = false;
  await offer.save();
  sendResponse(res, 200, 'Offer removed');
});

// POST /offers/:salonId/feature   { days }  (owner buys featured listing)
exports.buyFeatured = asyncHandler(async (req, res) => {
  const days = parseInt(req.body.days, 10) || 30;
  const salon = await Salon.findById(req.params.salonId);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw ApiError.forbidden('Not your salon');
  }
  const base = salon.featuredExpiry && salon.featuredExpiry > new Date() ? salon.featuredExpiry : new Date();
  const expiry = new Date(base);
  expiry.setDate(expiry.getDate() + days);
  salon.isFeatured = true;
  salon.featuredExpiry = expiry;
  await salon.save();
  sendResponse(res, 200, `Salon featured until ${expiry.toISOString().slice(0, 10)}`, { featuredExpiry: expiry });
});
