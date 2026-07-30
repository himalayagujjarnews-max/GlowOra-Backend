const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/offer.controller');

const router = express.Router();

router.get('/', ctrl.list); // public

router.use(protect, restrictTo('owner', 'admin'));
router.post('/', ctrl.create);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);
router.post('/:salonId/feature', ctrl.buyFeatured);

module.exports = router;
