const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/blockout.controller');

const router = express.Router();

router.use(protect);

// Staff self-service leave requests
router.get('/mine', restrictTo('staff'), ctrl.mine);
router.post('/request', restrictTo('staff'), ctrl.requestLeave);
router.delete('/:id/withdraw', restrictTo('staff'), ctrl.withdraw);

// Owner/admin management
router.get('/', restrictTo('owner', 'admin'), ctrl.list);
router.post('/', restrictTo('owner', 'admin'), ctrl.create);
router.patch('/:id/respond', restrictTo('owner', 'admin'), ctrl.respond);
router.delete('/:id', restrictTo('owner', 'admin'), ctrl.remove);

module.exports = router;
