const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/coupon.controller');

const router = express.Router();

router.get('/', ctrl.listActive); // public

router.use(protect);
router.post('/validate', ctrl.validate);

// admin
router.post('/', restrictTo('admin'), ctrl.create);
router.get('/admin/all', restrictTo('admin'), ctrl.adminList);
router.patch('/:id', restrictTo('admin'), ctrl.update);
router.delete('/:id', restrictTo('admin'), ctrl.remove);

module.exports = router;
