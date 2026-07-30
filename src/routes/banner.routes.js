const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/banner.controller');

const router = express.Router();

router.get('/', ctrl.list); // public
router.post('/', protect, restrictTo('admin'), upload.single('image'), ctrl.create);
router.patch('/:id', protect, restrictTo('admin'), ctrl.update);
router.delete('/:id', protect, restrictTo('admin'), ctrl.remove);

module.exports = router;
