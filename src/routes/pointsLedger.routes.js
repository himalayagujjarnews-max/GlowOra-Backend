const express = require('express');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/pointsLedger.controller');

const router = express.Router();

router.use(protect);
router.get('/mine', ctrl.listMine);

module.exports = router;
