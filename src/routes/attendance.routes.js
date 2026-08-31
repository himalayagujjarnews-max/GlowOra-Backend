const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/attendance.controller');

const router = express.Router();

router.use(protect, restrictTo('owner', 'staff', 'admin'));
router.get('/', ctrl.list);
router.get('/mine', ctrl.mine);
router.get('/earnings', ctrl.earnings);
router.post('/', ctrl.mark);

module.exports = router;
