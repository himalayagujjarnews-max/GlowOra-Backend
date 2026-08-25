const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const idempotency = require('../middleware/idempotency');
const ctrl = require('../controllers/booking.controller');
const abandonedCartCtrl = require('../controllers/abandonedCart.controller');

const router = express.Router();

router.get('/availability', ctrl.getAvailability); // public

router.use(protect); // everything below requires login

// fired by Booking.js on mount when services are selected — lets the
// scheduler nudge the customer later if they never complete the booking
router.post('/abandoned-cart', restrictTo('customer'), abandonedCartCtrl.track);

router.post('/', restrictTo('customer'), idempotency, ctrl.create);
router.post('/walkin', restrictTo('owner', 'staff', 'admin'), ctrl.walkIn);
router.get('/mine', ctrl.getMine);
router.get('/staff-mine', restrictTo('staff', 'admin'), ctrl.getStaffMine);
router.get('/salon/:salonId', restrictTo('owner', 'staff', 'admin'), ctrl.getForSalon);
router.get('/salon/:salonId/queue', restrictTo('owner', 'staff', 'admin'), ctrl.getQueueForSalon);
router.patch('/:id/status', restrictTo('owner', 'staff', 'admin'), ctrl.updateStatus);
router.patch('/:id/reschedule', restrictTo('customer'), ctrl.reschedule);
router.patch('/:id/cancel', ctrl.cancel);
router.post('/:id/home-otp', restrictTo('customer'), ctrl.generateHomeOtp);
router.post('/:id/verify-home-otp', restrictTo('owner', 'staff', 'admin'), ctrl.verifyHomeOtp);
router.post('/:id/tip', restrictTo('customer'), ctrl.addTip);

module.exports = router;
