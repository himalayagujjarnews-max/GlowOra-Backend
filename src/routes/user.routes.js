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

// admin
router.get('/', restrictTo('admin'), ctrl.adminList);
router.patch('/:id/block', restrictTo('admin'), ctrl.setBlock);
router.post('/:id/wallet-adjust', restrictTo('admin'), ctrl.adjustWallet);

module.exports = router;
