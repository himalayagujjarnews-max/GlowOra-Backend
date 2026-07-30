const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/waitlist.controller');

const router = express.Router();

router.use(protect, restrictTo('customer'));
router.get('/mine', ctrl.mine);
router.post('/', ctrl.join);
router.delete('/:id', ctrl.leave);

module.exports = router;
