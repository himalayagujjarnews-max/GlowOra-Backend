const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/subscription.controller');

const router = express.Router();

router.get('/plans', ctrl.listPlans); // public

router.use(protect);
router.get('/mine', ctrl.mine);
router.post('/salon/subscribe', restrictTo('owner', 'admin'), ctrl.salonSubscribe);
router.post('/pass/buy', restrictTo('customer'), ctrl.buyPass);
router.patch('/:id/cancel', ctrl.cancel);

// admin plan management
router.post('/plans', restrictTo('admin'), ctrl.createPlan);
router.patch('/plans/:id', restrictTo('admin'), ctrl.updatePlan);

module.exports = router;
