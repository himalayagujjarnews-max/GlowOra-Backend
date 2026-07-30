const express = require('express');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/family.controller');

const router = express.Router();

router.use(protect);
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
