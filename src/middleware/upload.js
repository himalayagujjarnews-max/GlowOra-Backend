/**
 * Multer memory storage for image uploads (piped to Cloudinary).
 */
const multer = require('multer');
const ApiError = require('../utils/ApiError');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (/^image\/(jpe?g|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
  else cb(ApiError.badRequest('Only image files are allowed'), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

module.exports = upload;
