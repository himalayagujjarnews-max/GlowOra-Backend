const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/slot.controller');

const router = express.Router();

router.use(protect, restrictTo('owner', 'staff', 'admin'));
router.get('/', ctrl.list);
router.post('/generate', ctrl.generate);
router.post('/holiday', ctrl.markHoliday);
router.post('/block', ctrl.blockSlot);

module.exports = router;
