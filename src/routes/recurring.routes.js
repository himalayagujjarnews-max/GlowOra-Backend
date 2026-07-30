const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/recurring.controller');

const router = express.Router();

router.use(protect, restrictTo('customer'));
router.get('/mine', ctrl.mine);
router.post('/', ctrl.create);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
