const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/favorite.controller');

const router = express.Router();

router.use(protect, restrictTo('customer'));
router.get('/', ctrl.list);
router.post('/', ctrl.add);

// favorite stylists (separate collection — see favorite.controller.js)
router.get('/staff', ctrl.listStaff);
router.post('/staff', ctrl.addStaff);
router.delete('/staff/:staffId', ctrl.removeStaff);

router.delete('/:salonId', ctrl.remove);

module.exports = router;
