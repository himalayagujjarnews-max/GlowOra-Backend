/**
 * Cloudinary image uploads. Gracefully disabled if keys are absent.
 */
const cloudinary = require('cloudinary').v2;
const config = require('./env');
const logger = require('../utils/logger');

const enabled = Boolean(config.cloudinary.cloudName && config.cloudinary.apiKey);

if (enabled) {
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
  });
} else {
  logger.warn('⚠️  Cloudinary not configured — image uploads will be mocked in dev.');
}

/**
 * Upload a buffer or file path. Returns { url, publicId }.
 * In dev without keys, returns a placeholder URL.
 */
async function uploadImage(fileBuffer, folder = 'glowora') {
  if (!enabled) {
    return { url: `https://placehold.co/600x400?text=GlowOra`, publicId: `mock_${Date.now()}` };
  }
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder }, (err, result) => {
      if (err) return reject(err);
      resolve({ url: result.secure_url, publicId: result.public_id });
    });
    stream.end(fileBuffer);
  });
}

async function deleteImage(publicId) {
  if (!enabled || !publicId || publicId.startsWith('mock_')) return;
  await cloudinary.uploader.destroy(publicId);
}

module.exports = { cloudinary, uploadImage, deleteImage, enabled };
