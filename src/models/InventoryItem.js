/**
 * InventoryItem — salon's stock of consumables/products (shampoo, color, etc.).
 * Helps salons track usage and reorder.
 */
const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema(
  {
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    name: { type: String, required: true, trim: true },
    category: { type: String },
    unit: { type: String, default: 'pcs' }, // pcs, ml, gm
    quantity: { type: Number, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 5 },
    costPrice: { type: Number, default: 0 },
    supplier: { type: String },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

inventoryItemSchema.virtual('isLowStock').get(function () {
  return this.quantity <= this.lowStockThreshold;
});

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
