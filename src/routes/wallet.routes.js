const express = require('express');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/wallet.controller');

const router = express.Router();

router.use(protect);
router.get('/', ctrl.get);
router.get('/transactions', ctrl.transactions);
router.post('/topup/create-order', ctrl.createTopupOrder);
router.post('/topup/verify', ctrl.verifyTopup);

module.exports = router;
