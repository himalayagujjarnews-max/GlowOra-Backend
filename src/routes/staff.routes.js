const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/staff.controller');

const router = express.Router();

router.get('/', ctrl.list); // public (for booking screen)
router.post('/', protect, restrictTo('owner', 'admin'), ctrl.create);
router.patch('/:id', protect, restrictTo('owner', 'staff', 'admin'), ctrl.update);
router.delete('/:id', protect, restrictTo('owner', 'admin'), ctrl.remove);

module.exports = router;
