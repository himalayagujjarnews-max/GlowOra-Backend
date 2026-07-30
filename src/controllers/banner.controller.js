/**
 * Banner controller — public active banners + admin management with upload.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const { uploadImage, deleteImage } = require('../config/cloudinary');
const Banner = require('../models/Banner');

// GET /banners?city=&type=   (public)
exports.list = asyncHandler(async (req, res) => {
  const filter = { active: true, $or: [{ validUntil: null }, { validUntil: { $gte: new Date() } }] };
  if (req.query.type) filter.type = req.query.type;
  if (req.query.city) filter.$and = [{ $or: [{ city: null }, { city: req.query.city }] }];
  const banners = await Banner.find(filter).sort({ order: 1, createdAt: -1 });
  sendResponse(res, 200, 'Banners', { banners });
});

// POST /banners   (admin, multipart: image)
exports.create = asyncHandler(async (req, res) => {
  let image = req.body.image;
  let imagePublicId;
  if (req.file) {
    const up = await uploadImage(req.file.buffer, 'glowora/banners');
    image = up.url; imagePublicId = up.publicId;
  }
  if (!image) throw ApiError.badRequest('Banner image is required');
  const banner = await Banner.create({ ...req.body, image, imagePublicId });
  sendResponse(res, 201, 'Banner created', { banner });
});

// PATCH /banners/:id   (admin)
exports.update = asyncHandler(async (req, res) => {
  const banner = await Banner.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!banner) throw ApiError.notFound('Banner not found');
  sendResponse(res, 200, 'Banner updated', { banner });
});

// DELETE /banners/:id   (admin)
exports.remove = asyncHandler(async (req, res) => {
  const banner = await Banner.findByIdAndDelete(req.params.id);
  if (!banner) throw ApiError.notFound('Banner not found');
  if (banner.imagePublicId) await deleteImage(banner.imagePublicId);
  sendResponse(res, 200, 'Banner deleted');
});
