const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const adminIpAllowlist = require('../middleware/ipAllowlist');
const ctrl = require('../controllers/admin.controller');

const router = express.Router();

router.use(protect, restrictTo('admin'), adminIpAllowlist);

router.get('/stats', ctrl.stats);
router.get('/bookings', ctrl.bookings);
router.get('/reports/bookings-trend', ctrl.bookingsTrend);
router.get('/reports/bookings-by-city', ctrl.bookingsByCity);
router.get('/reports/summary', ctrl.summary);
router.get('/reports/export/bookings.csv', ctrl.exportBookingsCsv);
router.get('/audit-logs', ctrl.auditLogs);
router.get('/login-history', ctrl.loginHistory);
router.post('/broadcast', ctrl.broadcast);

module.exports = router;
