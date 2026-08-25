const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/consentForm.controller');

const router = express.Router();

router.post('/', protect, restrictTo('customer'), ctrl.create);
router.get('/:bookingId', protect, restrictTo('customer', 'owner', 'staff', 'admin'), ctrl.getForBooking);

module.exports = router;
