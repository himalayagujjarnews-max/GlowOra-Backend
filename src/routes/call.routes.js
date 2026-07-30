const express = require('express');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/call.controller');

const router = express.Router();

router.use(protect);
router.post('/token', ctrl.getToken);

module.exports = router;
