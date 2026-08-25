const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const ctrl = require('../controllers/customerNote.controller');

const router = express.Router();

router.get('/', protect, restrictTo('owner', 'staff', 'admin'), ctrl.list);
router.post('/', protect, restrictTo('owner', 'staff', 'admin'), ctrl.create);

module.exports = router;
