const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/customerReview.controller');

const router = express.Router();

router.get('/', protect, restrictTo('owner', 'staff', 'admin'), ctrl.listForCustomer);
router.post('/', protect, restrictTo('owner', 'staff', 'admin'), ctrl.create);

module.exports = router;
