const express = require('express');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/privacy.controller');

const router = express.Router();

router.use(protect);
router.get('/consent', ctrl.consentHistory);
router.post('/consent', ctrl.recordConsent);
router.get('/export', ctrl.exportData);
router.delete('/erase', ctrl.eraseAccount);

module.exports = router;
