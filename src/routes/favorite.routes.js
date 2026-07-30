const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/favorite.controller');

const router = express.Router();

router.use(protect, restrictTo('customer'));
router.get('/', ctrl.list);
router.post('/', ctrl.add);
router.delete('/:salonId', ctrl.remove);

module.exports = router;
