const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const upload = require('../middleware/upload');
const idempotency = require('../middleware/idempotency');
const product = require('../controllers/product.controller');
const cart = require('../controllers/cart.controller');
const order = require('../controllers/order.controller');

const router = express.Router();

/* ---------- Categories ---------- */
router.get('/categories', product.listCategories);
router.post('/categories', protect, restrictTo('admin'), product.createCategory);
router.patch('/categories/:id', protect, restrictTo('admin'), product.updateCategory);

/* ---------- Products ---------- */
router.get('/products', product.listProducts);
router.get('/products/:id', product.getProduct);
router.post('/products', protect, restrictTo('admin'), upload.array('images', 6), product.createProduct);
router.patch('/products/:id', protect, restrictTo('admin'), product.updateProduct);
router.delete('/products/:id', protect, restrictTo('admin'), product.deleteProduct);

/* ---------- Cart ---------- */
router.get('/cart', protect, cart.get);
router.post('/cart', protect, cart.add);
router.patch('/cart', protect, cart.update);
router.delete('/cart', protect, cart.clear);

/* ---------- Orders ---------- */
router.get('/orders', protect, restrictTo('admin'), order.adminList);
router.post('/orders', protect, idempotency, order.create);
router.get('/orders/mine', protect, order.mine);
router.get('/orders/:id', protect, order.getOne);
router.post('/orders/:id/verify-payment', protect, order.verifyPayment);
router.patch('/orders/:id/cancel', protect, order.cancel);
router.patch('/orders/:id/status', protect, restrictTo('admin'), order.updateStatus);

module.exports = router;
