const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/shift.controller');

const router = express.Router();

router.get('/', protect, restrictTo('owner', 'staff', 'admin'), ctrl.listForSalon);
router.post('/', protect, restrictTo('owner', 'admin'), ctrl.upsert);
router.delete('/:id', protect, restrictTo('owner', 'admin'), ctrl.remove);

module.exports = router;
