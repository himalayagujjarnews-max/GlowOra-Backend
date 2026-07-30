const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/productReview.controller');

const router = express.Router();

router.get('/', ctrl.list); // public
router.post('/', protect, restrictTo('customer'), ctrl.create);
router.delete('/:id', protect, ctrl.remove);

module.exports = router;
