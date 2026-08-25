/**
 * Inventory controller — salon stock management with low-stock alerts.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const InventoryItem = require('../models/InventoryItem');
const Salon = require('../models/Salon');
const { notifyUser } = require('../services/notification.service');

async function assertOwns(user, salonId) {
  const salon = await Salon.findById(salonId);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== user._id.toString() && user.role !== 'admin') {
    throw ApiError.forbidden('Not your salon');
  }
  return salon;
}

// GET /inventory?salon=&lowStock=
exports.list = asyncHandler(async (req, res) => {
  if (!req.query.salon) throw ApiError.badRequest('salon query param required');
  await assertOwns(req.user, req.query.salon);
  const items = await InventoryItem.find({ salon: req.query.salon, active: true }).sort({ name: 1 });
  const data = items.map((i) => ({ ...i.toObject(), isLowStock: i.quantity <= i.lowStockThreshold }));
  const filtered = req.query.lowStock === 'true' ? data.filter((i) => i.isLowStock) : data;
  sendResponse(res, 200, 'Inventory', { items: filtered });
});

// POST /inventory  (owner)
exports.create = asyncHandler(async (req, res) => {
  const { salon, name } = req.body;
  if (!salon || !name) throw ApiError.badRequest('salon and name are required');
  await assertOwns(req.user, salon);
  const item = await InventoryItem.create(req.body);
  sendResponse(res, 201, 'Inventory item added', { item });
});

// PATCH /inventory/:id  (owner) — update details or adjust quantity
exports.update = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) throw ApiError.notFound('Item not found');
  await assertOwns(req.user, item.salon);
  const allowed = ['name', 'category', 'unit', 'quantity', 'lowStockThreshold', 'costPrice', 'supplier', 'active'];
  allowed.forEach((k) => { if (req.body[k] !== undefined) item[k] = req.body[k]; });
  await item.save();
  sendResponse(res, 200, 'Inventory updated', { item });
});

// POST /inventory/:id/adjust  { delta }  — quick +/- stock change
exports.adjust = asyncHandler(async (req, res) => {
  const delta = parseInt(req.body.delta, 10);
  if (!delta) throw ApiError.badRequest('delta required (e.g. -1 or +10)');
  const item = await InventoryItem.findById(req.params.id);
  if (!item) throw ApiError.notFound('Item not found');
  const salon = await assertOwns(req.user, item.salon);

  const wasLowStock = item.quantity <= item.lowStockThreshold;
  item.quantity = Math.max(0, item.quantity + delta);
  await item.save();

  // Only fire when the item just CROSSED into low-stock (not already low) —
  // avoids re-notifying the owner on every subsequent adjustment while stock
  // stays low.
  const isLowStock = item.quantity <= item.lowStockThreshold;
  if (isLowStock && !wasLowStock) {
    notifyUser(salon.owner, {
      title: 'Low stock alert',
      body: `${item.name} is running low (${item.quantity} ${item.unit || 'left'})`,
      type: 'system',
    });
  }

  sendResponse(res, 200, 'Stock adjusted', { item });
});

// DELETE /inventory/:id  (owner)
exports.remove = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) throw ApiError.notFound('Item not found');
  await assertOwns(req.user, item.salon);
  item.active = false;
  await item.save();
  sendResponse(res, 200, 'Item removed');
});
