const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/support.controller');

const router = express.Router();

router.use(protect);

// admin list first (specific before :id)
router.get('/admin/all', restrictTo('admin'), ctrl.adminList);

router.post('/', ctrl.create);
router.get('/mine', ctrl.mine);
router.get('/:id', ctrl.getOne);
router.post('/:id/reply', ctrl.reply);
router.patch('/:id/status', restrictTo('admin'), ctrl.setStatus);

module.exports = router;
