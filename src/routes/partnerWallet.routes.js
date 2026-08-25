const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/partnerWallet.controller');

const router = express.Router();

router.use(protect, restrictTo('owner', 'staff', 'admin'));

router.get('/mine', ctrl.getMine);
router.get('/transactions', ctrl.transactions);
router.post('/transfer-to-staff', restrictTo('owner', 'admin'), ctrl.transferToStaff);

module.exports = router;
