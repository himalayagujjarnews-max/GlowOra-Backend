const express = require('express');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/session.controller');

const router = express.Router();

router.use(protect);
router.get('/', ctrl.list);
router.get('/login-history', ctrl.loginHistory);
router.delete('/', ctrl.revokeAll);
router.delete('/:id', ctrl.revoke);

module.exports = router;
