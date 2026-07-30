const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/inventory.controller');

const router = express.Router();

router.use(protect, restrictTo('owner', 'admin'));
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.post('/:id/adjust', ctrl.adjust);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
