const express = require('express');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/twofactor.controller');

const router = express.Router();

router.use(protect);
router.get('/status', ctrl.status);
router.post('/setup', ctrl.setup);
router.post('/enable', ctrl.enable);
router.post('/disable', ctrl.disable);
router.post('/backup-codes/regenerate', ctrl.regenerateBackupCodes);

module.exports = router;
