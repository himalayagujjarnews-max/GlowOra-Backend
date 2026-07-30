const express = require('express');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/notification.controller');

const router = express.Router();

router.use(protect);
router.get('/', ctrl.list);
router.patch('/read-all', ctrl.markAllRead);
router.patch('/:id/read', ctrl.markRead);

module.exports = router;
