const express = require('express');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimiter');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/auth.controller');

const router = express.Router();

const phoneRule = body('phone').matches(/^[6-9]\d{9}$/).withMessage('Enter a valid mobile number');

router.post('/send-otp', authLimiter, [phoneRule], validate, ctrl.sendOtp);
router.post('/verify-otp', authLimiter, [phoneRule, body('otp').isLength({ min: 4, max: 6 })], validate, ctrl.verifyOtp);
// login accepts phone OR email + password (validation done in controller)
router.post('/login', authLimiter, [body('password').notEmpty()], validate, ctrl.login);
router.post('/forgot-password', authLimiter, [phoneRule], validate, ctrl.forgotPassword);
router.post('/reset-password', authLimiter, [phoneRule, body('otp').notEmpty(), body('password').notEmpty()], validate, ctrl.resetPassword);
router.post('/refresh', ctrl.refresh);

// email verification / login
router.post('/send-email-otp', authLimiter, [body('email').isEmail()], validate, ctrl.sendEmailOtp);
router.post('/verify-email', authLimiter, [body('email').isEmail(), body('otp').isLength({ min: 4, max: 6 })], validate, ctrl.verifyEmail);

router.post('/set-password', protect, ctrl.setPassword);
router.post('/logout', protect, ctrl.logout);
router.post('/fcm-token', protect, ctrl.registerFcm);
router.get('/me', protect, ctrl.getMe);

module.exports = router;
