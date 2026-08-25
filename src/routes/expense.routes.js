const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/expense.controller');

const router = express.Router();

router.use(protect, restrictTo('owner', 'admin'));

router.get('/summary', ctrl.summary);
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.delete('/:id', ctrl.remove);

module.exports = router;
