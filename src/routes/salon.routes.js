const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/salon.controller');

const router = express.Router();

// public
router.get('/nearby', ctrl.getNearby);
router.get('/search', ctrl.search);

// owner
router.post('/', protect, restrictTo('owner', 'admin'), ctrl.create);
router.get('/mine', protect, restrictTo('owner', 'admin'), ctrl.getMine);

// admin
router.get('/admin/all', protect, restrictTo('admin'), ctrl.adminList);
router.patch('/:id/status', protect, restrictTo('admin'), ctrl.setStatus);
router.patch('/:id/feature', protect, restrictTo('admin'), ctrl.toggleFeature);

// images
router.post('/:id/images', protect, restrictTo('owner', 'admin'), upload.array('images', 8), ctrl.uploadImages);

// public detail + owner update (keep params last)
router.get('/:id', ctrl.getById);
router.patch('/:id/bank', protect, restrictTo('owner', 'admin'), ctrl.updateBank);
router.patch('/:id', protect, restrictTo('owner', 'admin'), ctrl.update);

module.exports = router;
