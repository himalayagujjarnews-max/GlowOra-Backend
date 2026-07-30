const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/campaign.controller');

const router = express.Router();

router.use(protect, restrictTo('owner', 'admin'));
router.get('/', ctrl.list);
router.get('/segment-count', ctrl.segmentCount);
router.post('/', ctrl.create);
router.post('/:id/send', ctrl.send);

module.exports = router;
