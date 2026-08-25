const express = require('express');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/consultation.controller');

const router = express.Router();

router.use(protect);
router.post('/', ctrl.request); // customer
router.get('/mine', ctrl.mine); // customer or staff/owner
router.patch('/:id/respond', ctrl.respond); // owner/staff
router.get('/:id/token', ctrl.getToken); // either side, once accepted

module.exports = router;
