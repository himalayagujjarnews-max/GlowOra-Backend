const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/review.controller');

const router = express.Router();

router.get('/', ctrl.listForSalon); // public
router.post('/', protect, restrictTo('customer'), ctrl.create);
router.patch('/:id/reply', protect, restrictTo('owner', 'admin'), ctrl.reply);

module.exports = router;
