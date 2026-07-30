const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const idempotency = require('../middleware/idempotency');
const ctrl = require('../controllers/payment.controller');

const router = express.Router();

// webhook is public (verified via signature); mounted with raw body in app.js
router.post('/webhook', ctrl.webhook);

router.use(protect);
router.post('/create-order', restrictTo('customer'), idempotency, ctrl.createOrder);
router.post('/verify', restrictTo('customer'), idempotency, ctrl.verify);
router.get('/mine', ctrl.myPayments);

module.exports = router;
