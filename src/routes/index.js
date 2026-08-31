/**
 * Mounts all v1 routes under /api/v1.
 */
const express = require('express');

const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const addressRoutes = require('./address.routes');
const salonRoutes = require('./salon.routes');
const serviceRoutes = require('./service.routes');
const packageRoutes = require('./package.routes');
const staffRoutes = require('./staff.routes');
const shiftRoutes = require('./shift.routes');
const attendanceRoutes = require('./attendance.routes');
const bookingRoutes = require('./booking.routes');
const paymentRoutes = require('./payment.routes');
const walletRoutes = require('./wallet.routes');
const couponRoutes = require('./coupon.routes');
const reviewRoutes = require('./review.routes');
const customerReviewRoutes = require('./customerReview.routes');
const customerNoteRoutes = require('./customerNote.routes');
const consentFormRoutes = require('./consentForm.routes');
const favoriteRoutes = require('./favorite.routes');
const notificationRoutes = require('./notification.routes');
const chatRoutes = require('./chat.routes');
const callRoutes = require('./call.routes');
const consultationRoutes = require('./consultation.routes');
const cityRoutes = require('./city.routes');
const bannerRoutes = require('./banner.routes');
const supportRoutes = require('./support.routes');
const payoutRoutes = require('./payout.routes');
const partnerWalletRoutes = require('./partnerWallet.routes');
const adminRoutes = require('./admin.routes');
const shopRoutes = require('./shop.routes');
const familyRoutes = require('./family.routes');
const slotRoutes = require('./slot.routes');
const subscriptionRoutes = require('./subscription.routes');
const voucherRoutes = require('./voucher.routes');
const offerRoutes = require('./offer.routes');
const analyticsRoutes = require('./analytics.routes');
const productReviewRoutes = require('./productReview.routes');
const twoFactorRoutes = require('./twofactor.routes');
const sessionRoutes = require('./session.routes');
const privacyRoutes = require('./privacy.routes');
const waitlistRoutes = require('./waitlist.routes');
const recurringRoutes = require('./recurring.routes');
const inventoryRoutes = require('./inventory.routes');
const campaignRoutes = require('./campaign.routes');
const aiRoutes = require('./ai.routes');
const pointsLedgerRoutes = require('./pointsLedger.routes');
const expenseRoutes = require('./expense.routes');
const referralRoutes = require('./referral.routes');
const blockoutRoutes = require('./blockout.routes');
const docsRoutes = require('./docs.routes');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'GlowOra API v1',
    modules: [
      'auth', '2fa', 'sessions', 'privacy', 'users', 'addresses', 'family',
      'salons', 'services', 'packages', 'staff', 'shifts', 'attendance', 'slots', 'bookings',
      'payments', 'wallet', 'coupons', 'offers', 'subscriptions', 'vouchers',
      'reviews', 'customer-reviews', 'customer-notes', 'consent-forms', 'product-reviews', 'favorites', 'notifications', 'chat', 'calls', 'consultations',
      'analytics', 'cities', 'banners', 'support', 'payouts', 'partner-wallet', 'admin', 'shop',
      'waitlist', 'recurring', 'inventory', 'campaigns', 'ai', 'points-ledger', 'expenses', 'referral',
    ],
    docs: '/api/v1/docs',
  });
});

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/addresses', addressRoutes);
router.use('/salons', salonRoutes);
router.use('/services', serviceRoutes);
router.use('/packages', packageRoutes);
router.use('/staff', staffRoutes);
router.use('/shifts', shiftRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/bookings', bookingRoutes);
router.use('/payments', paymentRoutes);
router.use('/wallet', walletRoutes);
router.use('/coupons', couponRoutes);
router.use('/reviews', reviewRoutes);
router.use('/customer-reviews', customerReviewRoutes);
router.use('/customer-notes', customerNoteRoutes);
router.use('/consent-forms', consentFormRoutes);
router.use('/favorites', favoriteRoutes);
router.use('/notifications', notificationRoutes);
router.use('/chat', chatRoutes);
router.use('/calls', callRoutes);
router.use('/consultations', consultationRoutes);
router.use('/cities', cityRoutes);
router.use('/banners', bannerRoutes);
router.use('/support', supportRoutes);
router.use('/payouts', payoutRoutes);
router.use('/partner-wallet', partnerWalletRoutes);
router.use('/admin', adminRoutes);
router.use('/shop', shopRoutes);
router.use('/family', familyRoutes);
router.use('/slots', slotRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/vouchers', voucherRoutes);
router.use('/offers', offerRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/product-reviews', productReviewRoutes);
router.use('/2fa', twoFactorRoutes);
router.use('/sessions', sessionRoutes);
router.use('/privacy', privacyRoutes);
router.use('/waitlist', waitlistRoutes);
router.use('/recurring', recurringRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/campaigns', campaignRoutes);
router.use('/ai', aiRoutes);
router.use('/points-ledger', pointsLedgerRoutes);
router.use('/expenses', expenseRoutes);
router.use('/referral', referralRoutes);
router.use('/blockouts', blockoutRoutes);
router.use('/', docsRoutes); // /docs and /docs.json

module.exports = router;
