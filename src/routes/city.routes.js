const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/city.controller');

const router = express.Router();

router.get('/', ctrl.list); // public
router.post('/', protect, restrictTo('admin'), ctrl.create);
router.patch('/:id', protect, restrictTo('admin'), ctrl.update);
router.delete('/:id', protect, restrictTo('admin'), ctrl.remove);

module.exports = router;
