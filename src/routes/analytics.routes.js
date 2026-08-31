const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/analytics.controller');

const router = express.Router();

router.use(protect);

// invoice — customer or salon
router.get('/invoice/:bookingId', ctrl.invoice);

// salon analytics — owner/admin
router.use(restrictTo('owner', 'admin'));
router.get('/:salonId/dashboard', ctrl.dashboard);
router.get('/:salonId/popular-services', ctrl.popularServices);
router.get('/:salonId/peak-hours', ctrl.peakHours);
router.get('/:salonId/peak-hours-heatmap', ctrl.peakHoursHeatmap);
router.get('/:salonId/slow-periods', ctrl.suggestSlowPeriods);
router.get('/:salonId/retention', ctrl.retention);
router.get('/:salonId/staff-performance', ctrl.staffPerformance);
router.get('/:salonId/staff-utilization', ctrl.staffUtilization);
router.get('/:salonId/service-margin', ctrl.serviceMargin);
router.get('/:salonId/commissions', ctrl.commissions);
router.get('/:salonId/revenue-trend', ctrl.revenueTrend);

module.exports = router;
