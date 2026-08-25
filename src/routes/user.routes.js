const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/user.controller');

const router = express.Router();

router.use(protect);

// self
router.get('/profile', ctrl.getProfile);
router.patch('/profile', ctrl.updateProfile);
router.post('/avatar', upload.single('image'), ctrl.updateAvatar);
router.get('/wallet', ctrl.getWallet);
router.delete('/me', ctrl.deleteAccount);

// Identity selfie — owner/staff only (not customers, per the owner's request).
router.post('/selfie', restrictTo('owner', 'staff', 'admin'), upload.single('image'), ctrl.uploadSelfie);

// admin
router.get('/', restrictTo('admin'), ctrl.adminList);
router.get('/admin/identity-verifications', restrictTo('admin'), ctrl.adminListIdentityVerifications);
router.patch('/:id/identity-verification', restrictTo('admin'), ctrl.reviewIdentityVerification);
router.patch('/:id/block', restrictTo('admin'), ctrl.setBlock);
router.post('/:id/wallet-adjust', restrictTo('admin'), ctrl.adjustWallet);

module.exports = router;
