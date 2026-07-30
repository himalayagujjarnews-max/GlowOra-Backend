/**
 * ServicePackage controller — salon owners bundle services at a deal price.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const ServicePackage = require('../models/ServicePackage');
const Salon = require('../models/Salon');

async function assertOwns(user, salonId) {
  const salon = await Salon.findById(salonId);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== user._id.toString() && user.role !== 'admin') {
    throw ApiError.forbidden('Not your salon');
  }
}

// GET /packages?salon=
exports.list = asyncHandler(async (req, res) => {
  if (!req.query.salon) throw ApiError.badRequest('salon query param required');
  const packages = await ServicePackage.find({ salon: req.query.salon, active: true }).populate('services', 'name price durationMinutes');
  sendResponse(res, 200, 'Packages', { packages });
});

// POST /packages  (owner)
exports.create = asyncHandler(async (req, res) => {
  const { salon, name, packagePrice, originalPrice, durationMinutes } = req.body;
  if (!salon || !name || packagePrice == null || originalPrice == null || !durationMinutes) {
    throw ApiError.badRequest('salon, name, packagePrice, originalPrice and durationMinutes are required');
  }
  await assertOwns(req.user, salon);
  const pkg = await ServicePackage.create(req.body);
  sendResponse(res, 201, 'Package created', { package: pkg });
});

// PATCH /packages/:id  (owner)
exports.update = asyncHandler(async (req, res) => {
  const pkg = await ServicePackage.findById(req.params.id);
  if (!pkg) throw ApiError.notFound('Package not found');
  await assertOwns(req.user, pkg.salon);
  const allowed = ['name', 'description', 'services', 'originalPrice', 'packagePrice', 'durationMinutes', 'image', 'forGender', 'active'];
  allowed.forEach((k) => { if (req.body[k] !== undefined) pkg[k] = req.body[k]; });
  await pkg.save();
  sendResponse(res, 200, 'Package updated', { package: pkg });
});

// DELETE /packages/:id  (owner)
exports.remove = asyncHandler(async (req, res) => {
  const pkg = await ServicePackage.findById(req.params.id);
  if (!pkg) throw ApiError.notFound('Package not found');
  await assertOwns(req.user, pkg.salon);
  pkg.active = false;
  await pkg.save();
  sendResponse(res, 200, 'Package removed');
});
