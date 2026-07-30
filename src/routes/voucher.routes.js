const express = require('express');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/voucher.controller');

const router = express.Router();

router.use(protect);
router.get('/mine', ctrl.mine);
router.post('/buy', ctrl.buy);
router.post('/redeem', ctrl.redeem);

module.exports = router;
