const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const idempotency = require('../middleware/idempotency');
const ctrl = require('../controllers/booking.controller');

const router = express.Router();

router.get('/availability', ctrl.getAvailability); // public

router.use(protect); // everything below requires login

router.post('/', restrictTo('customer'), idempotency, ctrl.create);
router.post('/walkin', restrictTo('owner', 'staff', 'admin'), ctrl.walkIn);
router.get('/mine', ctrl.getMine);
router.get('/staff-mine', restrictTo('staff', 'admin'), ctrl.getStaffMine);
router.get('/salon/:salonId', restrictTo('owner', 'staff', 'admin'), ctrl.getForSalon);
router.patch('/:id/status', restrictTo('owner', 'staff', 'admin'), ctrl.updateStatus);
router.patch('/:id/reschedule', restrictTo('customer'), ctrl.reschedule);
router.patch('/:id/cancel', ctrl.cancel);
router.post('/:id/home-otp', restrictTo('customer'), ctrl.generateHomeOtp);
router.post('/:id/verify-home-otp', restrictTo('owner', 'staff', 'admin'), ctrl.verifyHomeOtp);
router.post('/:id/tip', restrictTo('customer'), ctrl.addTip);

module.exports = router;
