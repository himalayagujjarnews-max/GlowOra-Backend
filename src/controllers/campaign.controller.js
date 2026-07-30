/**
 * Campaign controller — salons run targeted marketing blasts to customer
 * segments derived from their own booking history.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const Campaign = require('../models/Campaign');
const Booking = require('../models/Booking');
const Salon = require('../models/Salon');
const { notifyUser } = require('../services/notification.service');

async function assertOwns(user, salonId) {
  const salon = await Salon.findById(salonId);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== user._id.toString() && user.role !== 'admin') {
    throw ApiError.forbidden('Not your salon');
  }
  return salon;
}

/** Resolve the set of customer ids for a segment at a salon. */
async function resolveSegment(salonId, segment, inactiveDays = 60) {
  if (segment === 'inactive') {
    const cutoff = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);
    // customers who booked before, but not since cutoff
    const recent = await Booking.distinct('customer', { salon: salonId, createdAt: { $gte: cutoff } });
    const all = await Booking.distinct('customer', { salon: salonId });
    const recentSet = new Set(recent.map(String));
    return all.filter((id) => !recentSet.has(String(id)));
  }
  if (segment === 'new') {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return Booking.distinct('customer', { salon: salonId, createdAt: { $gte: cutoff } });
  }
  if (segment === 'high_value') {
    const agg = await Booking.aggregate([
      { $match: { salon: salonId, status: 'completed' } },
      { $group: { _id: '$customer', spent: { $sum: '$total' } } },
      { $match: { spent: { $gte: 2000 } } },
    ]);
    return agg.map((a) => a._id);
  }
  // all_customers
  return Booking.distinct('customer', { salon: salonId });
}

// GET /campaigns?salon=
exports.list = asyncHandler(async (req, res) => {
  if (!req.query.salon) throw ApiError.badRequest('salon query param required');
  await assertOwns(req.user, req.query.salon);
  const campaigns = await Campaign.find({ salon: req.query.salon }).sort({ createdAt: -1 });
  sendResponse(res, 200, 'Campaigns', { campaigns });
});

// GET /campaigns/segment-count?salon=&segment=&inactiveDays=  (preview reach)
exports.segmentCount = asyncHandler(async (req, res) => {
  const { salon, segment = 'all_customers', inactiveDays } = req.query;
  if (!salon) throw ApiError.badRequest('salon query param required');
  await assertOwns(req.user, salon);
  const ids = await resolveSegment(salon, segment, parseInt(inactiveDays, 10) || 60);
  sendResponse(res, 200, 'Segment size', { count: ids.length });
});

// POST /campaigns  (owner) — create a draft
exports.create = asyncHandler(async (req, res) => {
  const { salon, name, title, message } = req.body;
  if (!salon || !name || !title || !message) {
    throw ApiError.badRequest('salon, name, title and message are required');
  }
  await assertOwns(req.user, salon);
  const campaign = await Campaign.create(req.body);
  sendResponse(res, 201, 'Campaign created', { campaign });
});

// POST /campaigns/:id/send  (owner) — send to the segment
exports.send = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) throw ApiError.notFound('Campaign not found');
  await assertOwns(req.user, campaign.salon);
  if (campaign.status === 'sent') throw ApiError.badRequest('Campaign already sent');

  const ids = await resolveSegment(campaign.salon, campaign.segment, campaign.inactiveDays);
  for (const uid of ids) {
    notifyUser(uid, {
      title: campaign.title,
      body: campaign.message + (campaign.couponCode ? ` Use code ${campaign.couponCode}.` : ''),
      type: 'promo', data: { salonId: campaign.salon.toString(), campaignId: campaign._id.toString() },
    });
  }
  campaign.status = 'sent';
  campaign.recipientsCount = ids.length;
  campaign.sentAt = new Date();
  await campaign.save();
  sendResponse(res, 200, `Campaign sent to ${ids.length} customers`, { campaign });
});
