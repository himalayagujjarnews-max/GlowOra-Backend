/**
 * OpenAPI 3.0 spec (concise). Served as JSON at /api/docs.json and rendered
 * with Swagger UI at /api/docs. Kept hand-maintained and lightweight — it
 * documents the auth model, conventions, and the full module/endpoint map.
 */
const config = require('../config/env');

const bearer = [{ bearerAuth: [] }];

// helper to reduce repetition
const op = (summary, tag, { auth = true, body, params, query } = {}) => {
  const o = { summary, tags: [tag], responses: { 200: { description: 'Success' }, 400: { description: 'Bad request' } } };
  if (auth) o.security = bearer;
  if (body) o.requestBody = { content: { 'application/json': { example: body } } };
  if (params) o.parameters = params;
  if (query) o.parameters = (o.parameters || []).concat(query);
  return o;
};

const P = (name, where = 'path') => ({ name, in: where, required: where === 'path', schema: { type: 'string' } });

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'GlowOra API',
    version: '1.0.0',
    description:
      'Backend for the GlowOra beauty super-app (customer, partner, admin, shop). '
      + 'Auth: send Bearer access token in the Authorization header. '
      + 'Access tokens last 15m; refresh via /auth/refresh (session-backed, rotating). '
      + 'Sensitive/mutating requests are audit-logged. Payments/orders/bookings accept an '
      + 'Idempotency-Key header to prevent duplicates.',
  },
  servers: [{ url: `${config.apiUrl}/api/v1`, description: config.env }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  },
  tags: [
    { name: 'Auth' }, { name: '2FA' }, { name: 'Sessions' }, { name: 'Privacy' },
    { name: 'Users' }, { name: 'Addresses' }, { name: 'Family' }, { name: 'Salons' },
    { name: 'Services' }, { name: 'Packages' }, { name: 'Staff' }, { name: 'Attendance' },
    { name: 'Slots' }, { name: 'Bookings' }, { name: 'Waitlist' }, { name: 'Recurring' },
    { name: 'Payments' }, { name: 'Wallet' }, { name: 'Coupons' }, { name: 'Offers' },
    { name: 'Subscriptions' }, { name: 'Vouchers' }, { name: 'Reviews' }, { name: 'ProductReviews' },
    { name: 'Favorites' }, { name: 'Notifications' }, { name: 'Chat' }, { name: 'Calls' },
    { name: 'Analytics' }, { name: 'AI' }, { name: 'Inventory' }, { name: 'Campaigns' },
    { name: 'Cities' }, { name: 'Banners' }, { name: 'Support' }, { name: 'Payouts' },
    { name: 'Admin' }, { name: 'Shop' },
  ],
  paths: {
    // --- Auth ---
    '/auth/send-otp': { post: op('Send OTP to a phone', 'Auth', { auth: false, body: { phone: '9876543210' } }) },
    '/auth/verify-otp': { post: op('Verify OTP, login/register (returns tokens; 2FA gate)', 'Auth', { auth: false, body: { phone: '9876543210', otp: '1234', twoFactorCode: '123456' } }) },
    '/auth/login': { post: op('Password login (owner/admin) + 2FA gate', 'Auth', { auth: false, body: { phone: '9999999999', password: 'Admin@123', twoFactorCode: '123456' } }) },
    '/auth/forgot-password': { post: op('Send reset code', 'Auth', { auth: false, body: { phone: '9876543210' } }) },
    '/auth/reset-password': { post: op('Reset password with OTP', 'Auth', { auth: false, body: { phone: '9876543210', otp: '1234', password: 'NewPass1' } }) },
    '/auth/refresh': { post: op('Rotate refresh token', 'Auth', { auth: false, body: { refreshToken: '<token>' } }) },
    '/auth/set-password': { post: op('Set/change password', 'Auth', { body: { password: 'NewPass1' } }) },
    '/auth/fcm-token': { post: op('Register device push token', 'Auth', { body: { fcmToken: '<fcm>' } }) },
    '/auth/logout': { post: op('Logout current session', 'Auth') },
    '/auth/me': { get: op('Current user', 'Auth') },

    // --- 2FA ---
    '/2fa/status': { get: op('2FA status', '2FA') },
    '/2fa/setup': { post: op('Generate 2FA secret + QR url', '2FA') },
    '/2fa/enable': { post: op('Enable 2FA (verify first code)', '2FA', { body: { token: '123456' } }) },
    '/2fa/disable': { post: op('Disable 2FA', '2FA', { body: { token: '123456' } }) },
    '/2fa/backup-codes/regenerate': { post: op('Regenerate backup codes', '2FA', { body: { token: '123456' } }) },

    // --- Sessions ---
    '/sessions': { get: op('List active devices', 'Sessions'), delete: op('Log out all (keepCurrent?)', 'Sessions', { query: [P('keepCurrent', 'query')] }) },
    '/sessions/{id}': { delete: op('Revoke one device', 'Sessions', { params: [P('id')] }) },
    '/sessions/login-history': { get: op('My login history', 'Sessions') },

    // --- Privacy ---
    '/privacy/consent': { get: op('Consent history', 'Privacy'), post: op('Record consent', 'Privacy', { body: { type: 'marketing', version: '1.0', granted: true } }) },
    '/privacy/export': { get: op('Export all my data (GDPR)', 'Privacy') },
    '/privacy/erase': { delete: op('Erase account (right to be forgotten)', 'Privacy', { body: { confirm: 'DELETE' } }) },

    // --- Users / Addresses / Family ---
    '/users/profile': { get: op('Get profile', 'Users'), patch: op('Update profile', 'Users', { body: { name: 'Amit', city: 'Chandigarh' } }) },
    '/users/wallet': { get: op('Wallet summary', 'Users') },
    '/addresses': { get: op('List addresses', 'Addresses'), post: op('Add address', 'Addresses', { body: { line1: '123', city: 'Mohali', pincode: '160055' } }) },
    '/family': { get: op('List family members', 'Family'), post: op('Add family member', 'Family', { body: { name: 'Riya', relation: 'child' } }) },

    // --- Salons / Services / Staff ---
    '/salons/nearby': { get: op('Nearby salons', 'Salons', { auth: false, query: [P('lng', 'query'), P('lat', 'query'), P('city', 'query')] }) },
    '/salons/search': { get: op('Search salons', 'Salons', { auth: false, query: [P('q', 'query'), P('city', 'query')] }) },
    '/salons/{id}': { get: op('Salon detail', 'Salons', { auth: false, params: [P('id')] }) },
    '/salons': { post: op('Register salon (owner)', 'Salons', { body: { name: 'Style Hub', type: 'unisex', address: { city: 'Chandigarh' }, location: { coordinates: [76.7, 30.7] } } }) },
    '/services': { get: op('List services', 'Services', { auth: false, query: [P('salon', 'query')] }), post: op('Add service (owner)', 'Services', { body: { salon: '<id>', name: 'Haircut', category: 'hair', price: 150, durationMinutes: 30 } }) },
    '/staff': { get: op('List staff', 'Staff', { auth: false, query: [P('salon', 'query')] }), post: op('Add staff (creates login if phone given)', 'Staff', { body: { salon: '<id>', name: 'Rahul', phone: '9876500000' } }) },

    // --- Slots / Bookings ---
    '/slots/generate': { post: op('Auto-generate a day of slots (owner)', 'Slots', { body: { salon: '<id>', staff: '<id>', date: '2026-07-15' } }) },
    '/bookings/availability': { get: op('Free/booked slots', 'Bookings', { auth: false, query: [P('salon', 'query'), P('staff', 'query'), P('date', 'query')] }) },
    '/bookings': { post: op('Create booking (coupon/wallet/family supported)', 'Bookings', { body: { salon: '<id>', staff: '<id>', serviceIds: ['<id>'], date: '2026-07-15', startTime: '11:00', paymentMode: 'token', couponCode: 'GLOW50' } }) },
    '/bookings/mine': { get: op('My bookings', 'Bookings') },
    '/bookings/{id}/reschedule': { patch: op('Reschedule', 'Bookings', { params: [P('id')], body: { date: '2026-07-16', startTime: '12:00' } }) },
    '/bookings/{id}/cancel': { patch: op('Cancel (tiered refund)', 'Bookings', { params: [P('id')], body: { reason: 'change of plan' } }) },
    '/bookings/{id}/tip': { post: op('Tip stylist', 'Bookings', { params: [P('id')], body: { amount: 50 } }) },
    '/bookings/walkin': { post: op('Record walk-in (owner/staff)', 'Bookings', { body: { salon: '<id>', staff: '<id>', serviceIds: ['<id>'], customerName: 'Walk-in' } }) },

    // --- Waitlist / Recurring ---
    '/waitlist': { post: op('Join waitlist for a busy day', 'Waitlist', { body: { salon: '<id>', date: '2026-07-15' } }) },
    '/recurring': { post: op('Set up a recurring appointment', 'Recurring', { body: { salon: '<id>', staff: '<id>', serviceIds: ['<id>'], frequency: 'monthly', preferredTime: '11:00' } }) },

    // --- Payments / Wallet ---
    '/payments/create-order': { post: op('Create payment order', 'Payments', { body: { bookingId: '<id>' } }) },
    '/payments/verify': { post: op('Verify payment', 'Payments', { body: { razorpayOrderId: 'order_x', razorpayPaymentId: 'pay_x', razorpaySignature: 'sig' } }) },
    '/wallet': { get: op('Wallet balance', 'Wallet') },
    '/wallet/topup/create-order': { post: op('Create wallet top-up order', 'Wallet', { body: { amount: 500 } }) },

    // --- Coupons / Offers / Subs / Vouchers ---
    '/coupons/validate': { post: op('Validate a coupon', 'Coupons', { body: { code: 'GLOW50', orderValue: 500 } }) },
    '/offers': { get: op('Salon offers', 'Offers', { auth: false, query: [P('salon', 'query')] }) },
    '/subscriptions/plans': { get: op('Subscription plans', 'Subscriptions', { auth: false }) },
    '/subscriptions/pass/buy': { post: op('Buy customer Glow Pass', 'Subscriptions', { body: { planId: '<id>' } }) },
    '/vouchers/buy': { post: op('Buy gift voucher (paid from wallet)', 'Vouchers', { body: { amount: 500, recipientPhone: '9876500000' } }) },
    '/vouchers/redeem': { post: op('Redeem voucher to wallet', 'Vouchers', { body: { code: 'GIFTABC123' } }) },

    // --- Reviews / Favorites / Notifications ---
    '/reviews': { get: op('Salon reviews', 'Reviews', { auth: false, query: [P('salon', 'query')] }), post: op('Review a completed booking', 'Reviews', { body: { bookingId: '<id>', rating: 5, comment: 'Great!' } }) },
    '/product-reviews': { get: op('Product reviews', 'ProductReviews', { auth: false, query: [P('product', 'query')] }), post: op('Review a product', 'ProductReviews', { body: { product: '<id>', rating: 5 } }) },
    '/favorites': { get: op('My favorite salons', 'Favorites'), post: op('Add favorite', 'Favorites', { body: { salon: '<id>' } }) },
    '/notifications': { get: op('My notifications', 'Notifications') },

    // --- Chat / Calls ---
    '/chat/conversations': { get: op('My conversations', 'Chat'), post: op('Open conversation for a booking', 'Chat', { body: { bookingId: '<id>' } }) },
    '/calls/token': { post: op('Get Agora call token', 'Calls', { body: { bookingId: '<id>' } }) },

    // --- Analytics / AI ---
    '/analytics/{salonId}/dashboard': { get: op('Salon dashboard', 'Analytics', { params: [P('salonId')] }) },
    '/ai/recommendations': { get: op('Personalised recommendations', 'AI') },
    '/ai/face-analysis': { post: op('Skin guidance', 'AI', { body: { skinType: 'oily', concerns: ['acne'] } }) },
    '/ai/hair-analysis': { post: op('Hair guidance', 'AI', { body: { hairType: 'curly', concerns: ['frizz'] } }) },
    '/ai/demand-forecast': { get: op('Demand forecast (owner)', 'AI', { query: [P('salonId', 'query')] }) },
    '/ai/assistant': { post: op('FAQ assistant', 'AI', { body: { question: 'How do refunds work?' } }) },

    // --- Inventory / Campaigns ---
    '/inventory': { get: op('Inventory list (owner)', 'Inventory', { query: [P('salon', 'query')] }), post: op('Add inventory item', 'Inventory', { body: { salon: '<id>', name: 'Shampoo', quantity: 20 } }) },
    '/campaigns': { get: op('Campaigns (owner)', 'Campaigns', { query: [P('salon', 'query')] }), post: op('Create campaign', 'Campaigns', { body: { salon: '<id>', name: 'Winback', segment: 'inactive', title: 'We miss you!', message: '20% off' } }) },

    // --- Cities / Banners / Support / Payouts ---
    '/cities': { get: op('Live cities', 'Cities', { auth: false }) },
    '/banners': { get: op('Home banners', 'Banners', { auth: false }) },
    '/support': { post: op('Raise a support ticket', 'Support', { body: { subject: 'Issue', message: 'Details' } }) },
    '/payouts/mine': { get: op('My payouts (owner)', 'Payouts') },

    // --- Admin ---
    '/admin/stats': { get: op('Dashboard stats', 'Admin') },
    '/admin/audit-logs': { get: op('Audit logs', 'Admin') },
    '/admin/broadcast': { post: op('Broadcast notification', 'Admin', { body: { title: 'Hi', body: 'Offer!', target: 'customers' } }) },

    // --- Shop ---
    '/shop/products': { get: op('List products', 'Shop', { auth: false, query: [P('category', 'query')] }) },
    '/shop/cart': { get: op('My cart', 'Shop'), post: op('Add to cart', 'Shop', { body: { productId: '<id>', quantity: 1 } }) },
    '/shop/orders': { post: op('Place order', 'Shop', { body: { address: { line1: '1', city: 'Mohali', pincode: '160055' }, paymentMode: 'online' } }) },
  },
};
