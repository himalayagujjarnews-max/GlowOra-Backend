/**
 * Service controller — salon owners manage their offerings.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const Service = require('../models/Service');
const Salon = require('../models/Salon');
const { tryActivateSalon } = require('./salon.controller');

async function assertOwnsSalon(user, salonId) {
  const salon = await Salon.findById(salonId);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== user._id.toString() && user.role !== 'admin') {
    throw ApiError.forbidden('You can only manage your own salon services');
  }
  return salon;
}

// GET /api/v1/services?salon=&category=
exports.list = asyncHandler(async (req, res) => {
  const filter = { active: true };
  if (req.query.salon) filter.salon = req.query.salon;
  if (req.query.category) filter.category = req.query.category;
  const services = await Service.find(filter);
  sendResponse(res, 200, 'Services', { count: services.length, services });
});

// POST /api/v1/services  (owner)
exports.create = asyncHandler(async (req, res) => {
  const { salon, name, category, price, durationMinutes } = req.body;
  if (!salon || !name || !category || price == null || !durationMinutes) {
    throw ApiError.badRequest('salon, name, category, price and durationMinutes are required');
  }
  await assertOwnsSalon(req.user, salon);
  const service = await Service.create(req.body);
  const updatedSalon = await tryActivateSalon(salon);
  sendResponse(res, 201, 'Service added', { service, salonStatus: updatedSalon?.status });
});

// PATCH /api/v1/services/:id  (owner)
exports.update = asyncHandler(async (req, res) => {
  const service = await Service.findById(req.params.id);
  if (!service) throw ApiError.notFound('Service not found');
  await assertOwnsSalon(req.user, service.salon);
  const allowed = ['name', 'category', 'forGender', 'price', 'discountPrice', 'costPrice', 'durationMinutes', 'description', 'image', 'homeServiceAvailable', 'active'];
  allowed.forEach((k) => { if (req.body[k] !== undefined) service[k] = req.body[k]; });
  await service.save();
  sendResponse(res, 200, 'Service updated', { service });
});

// DELETE /api/v1/services/:id  (owner — soft delete)
exports.remove = asyncHandler(async (req, res) => {
  const service = await Service.findById(req.params.id);
  if (!service) throw ApiError.notFound('Service not found');
  await assertOwnsSalon(req.user, service.salon);
  service.active = false;
  await service.save();
  sendResponse(res, 200, 'Service removed');
});
