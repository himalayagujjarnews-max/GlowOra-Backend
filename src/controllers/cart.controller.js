/**
 * Cart controller — GlowOra Shop shopping cart.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { money } = require('../utils/helpers');

async function getPopulatedCart(userId) {
  let cart = await Cart.findOne({ user: userId }).populate('items.product', 'name price mrp images stock active');
  if (!cart) cart = await Cart.create({ user: userId, items: [] });
  const items = cart.items.filter((i) => i.product && i.product.active);
  const subtotal = money(items.reduce((s, i) => s + i.product.price * i.quantity, 0));
  return { cart, items, subtotal };
}

// GET /shop/cart
exports.get = asyncHandler(async (req, res) => {
  const { items, subtotal } = await getPopulatedCart(req.user._id);
  sendResponse(res, 200, 'Cart', { items, subtotal, count: items.reduce((s, i) => s + i.quantity, 0) });
});

// POST /shop/cart   { productId, quantity }
exports.add = asyncHandler(async (req, res) => {
  const { productId, quantity = 1 } = req.body;
  const product = await Product.findById(productId);
  if (!product || !product.active) throw ApiError.notFound('Product not found');
  if (product.stock < quantity) throw ApiError.badRequest('Not enough stock');

  let cart = await Cart.findOne({ user: req.user._id });
  if (!cart) cart = await Cart.create({ user: req.user._id, items: [] });

  const existing = cart.items.find((i) => i.product.toString() === productId);
  if (existing) existing.quantity += quantity;
  else cart.items.push({ product: productId, quantity, priceAtAdd: product.price });
  await cart.save();

  const { items, subtotal } = await getPopulatedCart(req.user._id);
  sendResponse(res, 200, 'Added to cart', { items, subtotal });
});

// PATCH /shop/cart   { productId, quantity }  (set absolute quantity; 0 removes)
exports.update = asyncHandler(async (req, res) => {
  const { productId, quantity } = req.body;
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) throw ApiError.notFound('Cart is empty');
  const item = cart.items.find((i) => i.product.toString() === productId);
  if (!item) throw ApiError.notFound('Item not in cart');
  if (quantity <= 0) cart.items = cart.items.filter((i) => i.product.toString() !== productId);
  else item.quantity = quantity;
  await cart.save();
  const { items, subtotal } = await getPopulatedCart(req.user._id);
  sendResponse(res, 200, 'Cart updated', { items, subtotal });
});

// DELETE /shop/cart   (clear)
exports.clear = asyncHandler(async (req, res) => {
  await Cart.findOneAndUpdate({ user: req.user._id }, { items: [], coupon: null });
  sendResponse(res, 200, 'Cart cleared');
});
