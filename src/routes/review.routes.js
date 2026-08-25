const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/review.controller');

const router = express.Router();

router.get('/', ctrl.listForSalon); // public
router.post('/', protect, restrictTo('customer'), ctrl.create);
router.post('/:id/images', protect, restrictTo('customer'), upload.array('images', 3), ctrl.uploadImages);
router.patch('/:id/reply', protect, restrictTo('owner', 'admin'), ctrl.reply);

module.exports = router;
