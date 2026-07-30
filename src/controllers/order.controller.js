/**
 * Order controller — GlowOra Shop checkout & order management.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const { getPagination, buildMeta } = require('../utils/pagination');
const { money } = require('../utils/helpers');
const rp = require('../config/razorpay');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { notifyUser } = require('../services/notification.service');

const SHIPPING_FEE = 49;
const FREE_SHIPPING_ABOVE = 499;

// POST /shop/orders   { address, paymentMode, couponCode? }
exports.create = asyncHandler(async (req, res) => {
  const { address, paymentMode = 'online' } = req.body;
  if (!address || !address.line1 || !address.city || !address.pincode) {
    throw ApiError.badRequest('Complete delivery address is required');
  }

  const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');
  if (!cart || !cart.items.length) throw ApiError.badRequest('Your cart is empty');

  // validate stock + build items
  const items = [];
  let subtotal = 0;
  for (const it of cart.items) {
    const p = it.product;
    if (!p || !p.active) continue;
    if (p.stock < it.quantity) throw ApiError.badRequest(`${p.name} is out of stock`);
    items.push({ product: p._id, name: p.name, image: p.images?.[0], price: p.price, quantity: it.quantity });
    subtotal += p.price * it.quantity;
  }
  if (!items.length) throw ApiError.badRequest('No valid items to order');
  subtotal = money(subtotal);

  const shippingFee = subtotal >= FREE_SHIPPING_ABOVE ? 0 : SHIPPING_FEE;
  const discount = 0; // coupon hook can be added here
  const total = money(subtotal + shippingFee - discount);

  const order = await Order.create({
    customer: req.user._id,
    items, address,
    subtotal, discount, shippingFee, total,
    paymentMode,
    paymentStatus: paymentMode === 'cod' ? 'pending' : 'pending',
    status: 'placed',
  });

  // decrement stock
  await Promise.all(items.map((i) => Product.findByIdAndUpdate(i.product, { $inc: { stock: -i.quantity } })));
  // clear cart
  cart.items = [];
  await cart.save();

  let payment = null;
  if (paymentMode === 'online') {
    const rzOrder = await rp.createOrder({ amount: total, receipt: order.orderCode, notes: { orderId: order._id.toString() } });
    order.razorpayOrderId = rzOrder.id;
    await order.save();
    payment = { orderId: rzOrder.id, amount: total, keyId: rp.keyId || 'mock', mock: rzOrder.mock || false };
  }

  notifyUser(req.user._id, { title: 'Order placed 🛍️', body: `Order ${order.orderCode} placed successfully.`, type: 'system', data: { orderId: order._id.toString() } });
  sendResponse(res, 201, 'Order placed', { order, payment });
});

// POST /shop/orders/:id/verify-payment   { razorpayPaymentId, razorpaySignature }
exports.verifyPayment = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.customer.toString() !== req.user._id.toString()) throw ApiError.forbidden('Not your order');

  const valid = rp.verifyPaymentSignature({
    orderId: order.razorpayOrderId,
    paymentId: req.body.razorpayPaymentId,
    signature: req.body.razorpaySignature,
  });
  if (!valid) throw ApiError.badRequest('Payment verification failed');

  order.paymentStatus = 'paid';
  order.razorpayPaymentId = req.body.razorpayPaymentId;
  order.status = 'confirmed';
  await order.save();
  sendResponse(res, 200, 'Payment verified', { order });
});

// GET /shop/orders/mine
exports.mine = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const [orders, total] = await Promise.all([
    Order.find({ customer: req.user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments({ customer: req.user._id }),
  ]);
  sendResponse(res, 200, 'Your orders', { orders }, buildMeta(page, limit, total));
});

// GET /shop/orders/:id
exports.getOne = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.customer.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    throw ApiError.forbidden('Not your order');
  }
  sendResponse(res, 200, 'Order', { order });
});

// PATCH /shop/orders/:id/cancel
exports.cancel = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.customer.toString() !== req.user._id.toString()) throw ApiError.forbidden('Not your order');
  if (['shipped', 'delivered', 'cancelled'].includes(order.status)) {
    throw ApiError.badRequest(`Cannot cancel a ${order.status} order`);
  }
  order.status = 'cancelled';
  await order.save();
  // restore stock
  await Promise.all(order.items.map((i) => Product.findByIdAndUpdate(i.product, { $inc: { stock: i.quantity } })));
  sendResponse(res, 200, 'Order cancelled', { order });
});

// ---- Admin ----
// GET /shop/orders   (admin, filter by status)
exports.adminList = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const [orders, total] = await Promise.all([
    Order.find(filter).populate('customer', 'name phone').sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter),
  ]);
  sendResponse(res, 200, 'Orders', { orders }, buildMeta(page, limit, total));
});

// PATCH /shop/orders/:id/status   { status, trackingId }  (admin)
exports.updateStatus = asyncHandler(async (req, res) => {
  const { status, trackingId } = req.body;
  const valid = ['placed', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'];
  if (!valid.includes(status)) throw ApiError.badRequest('Invalid status');
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  order.status = status;
  if (trackingId) order.trackingId = trackingId;
  if (status === 'delivered') order.deliveredAt = new Date();
  await order.save();
  notifyUser(order.customer, { title: 'Order update', body: `Your order ${order.orderCode} is now ${status}.`, type: 'system', data: { orderId: order._id.toString() } });
  sendResponse(res, 200, 'Order updated', { order });
});
