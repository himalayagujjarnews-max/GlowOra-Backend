const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/staff.controller');

const router = express.Router();

router.get('/mine', protect, restrictTo('staff'), ctrl.mine);
router.get('/', ctrl.list); // public (for booking screen)
router.post('/', protect, restrictTo('owner', 'admin'), ctrl.create);
router.patch('/:id', protect, restrictTo('owner', 'staff', 'admin'), ctrl.update);
router.delete('/:id', protect, restrictTo('owner', 'admin'), ctrl.remove);

// Portfolio (before/after work photos) — owner or the staff member themselves
// (self-access checked inside the controller via assertCanManagePortfolio,
// same reason `update` above allows role 'staff': the route can't tell WHICH
// staff doc without hitting the DB, so the fine-grained check lives there).
// upload.fields() (not .array()) since `before` and `after` are two distinct
// single-file fields, not one interchangeable gallery array.
router.post(
  '/:id/portfolio',
  protect,
  restrictTo('owner', 'staff', 'admin'),
  upload.fields([{ name: 'before', maxCount: 1 }, { name: 'after', maxCount: 1 }]),
  ctrl.addPortfolio
);
router.delete('/:id/portfolio/:entryId', protect, restrictTo('owner', 'staff', 'admin'), ctrl.removePortfolio);

// Bank details — self-access checked inside the controller (assertCanManageBank),
// same reasoning as the portfolio routes above.
router.get('/:id/bank', protect, restrictTo('owner', 'staff', 'admin'), ctrl.getBank);
router.patch('/:id/bank', protect, restrictTo('owner', 'staff', 'admin'), ctrl.updateBank);
router.patch('/:id/verify-bank', protect, restrictTo('admin'), ctrl.verifyBank);
router.get('/admin/pending-bank', protect, restrictTo('admin'), ctrl.pendingBankVerification);

module.exports = router;
