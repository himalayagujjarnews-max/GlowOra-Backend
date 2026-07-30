/**
 * City controller — public list of live cities + admin management.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const City = require('../models/City');

// GET /cities   (public — live + coming soon)
exports.list = asyncHandler(async (req, res) => {
  const filter = { active: true };
  if (req.query.status) filter.launchStatus = req.query.status;
  const cities = await City.find(filter).sort({ launchStatus: 1, name: 1 });
  sendResponse(res, 200, 'Cities', { cities });
});

// POST /cities   (admin)
exports.create = asyncHandler(async (req, res) => {
  const { name, state } = req.body;
  if (!name || !state) throw ApiError.badRequest('name and state are required');
  const city = await City.create(req.body);
  sendResponse(res, 201, 'City added', { city });
});

// PATCH /cities/:id   (admin)
exports.update = asyncHandler(async (req, res) => {
  const city = await City.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!city) throw ApiError.notFound('City not found');
  sendResponse(res, 200, 'City updated', { city });
});

// DELETE /cities/:id   (admin)
exports.remove = asyncHandler(async (req, res) => {
  const city = await City.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  if (!city) throw ApiError.notFound('City not found');
  sendResponse(res, 200, 'City deactivated');
});
