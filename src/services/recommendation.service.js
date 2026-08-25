/**
 * Recommendation engine — data-driven suggestions from real booking history.
 * No external AI needed; every suggestion is explainable. Hooks are provided
 * where a future ML model can be plugged in.
 */
const Booking = require('../models/Booking');
const Service = require('../models/Service');
const Salon = require('../models/Salon');
const Product = require('../models/Product');
const { escapeRegex } = require('../utils/helpers');

/** Services a customer books most, to prefill "book again". */
async function frequentServices(userId, limit = 5) {
  const agg = await Booking.aggregate([
    { $match: { customer: toId(userId), status: 'completed' } },
    { $unwind: '$services' },
    { $group: { _id: '$services.service', name: { $first: '$services.name' }, count: { $sum: 1 }, lastPrice: { $last: '$services.price' } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);
  return agg.map((a) => ({ serviceId: a._id, name: a.name, timesBooked: a.count, price: a.lastPrice, reason: 'You book this often' }));
}

/** "Customers who booked X also booked Y" — market-basket style. */
async function alsoBooked(serviceId, limit = 4) {
  const bookings = await Booking.find({ 'services.service': toId(serviceId) }).select('services').limit(500);
  const counts = {};
  for (const b of bookings) {
    for (const s of b.services) {
      const id = s.service?.toString();
      if (id && id !== String(serviceId)) counts[id] = (counts[id] || 0) + 1;
    }
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit);
  const services = await Service.find({ _id: { $in: top.map((t) => t[0]) } }).select('name price');
  return services.map((s) => ({ serviceId: s._id, name: s.name, price: s.price, reason: 'Often booked together' }));
}

/** Products to recommend based on the categories a customer uses most. */
async function recommendedProducts(userId, limit = 6) {
  const agg = await Booking.aggregate([
    { $match: { customer: toId(userId), status: 'completed' } },
    { $unwind: '$services' },
    { $lookup: { from: 'services', localField: 'services.service', foreignField: '_id', as: 'svc' } },
    { $unwind: { path: '$svc', preserveNullAndEmptyArrays: true } },
    { $group: { _id: '$svc.category', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 3 },
  ]);
  const categories = agg.map((a) => a._id).filter(Boolean);
  // map service categories to product tags loosely
  const query = categories.length ? { active: true, $or: [{ tags: { $in: categories } }, { isFeatured: true }] } : { active: true, isFeatured: true };
  const products = await Product.find(query).sort({ isFeatured: -1, rating: -1 }).limit(limit).select('name brand price mrp images rating');
  return products.map((p) => ({ product: p, reason: 'Based on your services' }));
}

/** Nearby salons a customer hasn't tried yet, ranked by rating. */
async function discoverSalons(userId, city, limit = 6) {
  const visited = await Booking.distinct('salon', { customer: toId(userId) });
  const filter = { status: 'active', _id: { $nin: visited } };
  if (city) filter['address.city'] = new RegExp(`^${escapeRegex(city)}$`, 'i');
  return Salon.find(filter).sort({ isFeatured: -1, rating: -1 }).limit(limit)
    .select('name coverImage address rating reviewCount type');
}

function toId(id) {
  const mongoose = require('mongoose');
  return typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id;
}

module.exports = { frequentServices, alsoBooked, recommendedProducts, discoverSalons };
