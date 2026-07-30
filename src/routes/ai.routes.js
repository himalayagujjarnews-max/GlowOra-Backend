const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/ai.controller');

const router = express.Router();

router.use(protect);
router.get('/recommendations', ctrl.recommendations);
router.get('/also-booked', ctrl.alsoBooked);
router.post('/face-analysis', ctrl.faceAnalysis);
router.post('/hair-analysis', ctrl.hairAnalysis);
router.post('/assistant', ctrl.assistant);
router.get('/demand-forecast', restrictTo('owner', 'admin'), ctrl.demandForecast);

module.exports = router;
