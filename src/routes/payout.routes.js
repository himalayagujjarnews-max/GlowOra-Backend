const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/payout.controller');

const router = express.Router();

router.use(protect);

router.get('/mine', restrictTo('owner', 'admin'), ctrl.mine);
router.get('/pending', restrictTo('admin'), ctrl.pending);
router.get('/', restrictTo('admin'), ctrl.adminList);
router.post('/', restrictTo('admin'), ctrl.create);

module.exports = router;
