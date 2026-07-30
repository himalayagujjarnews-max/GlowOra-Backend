/**
 * Order — a placed GlowOra Shop order.
 */
const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: String,
    image: String,
    price: Number,
    quantity: Number,
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderCode: { type: String, unique: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: [orderItemSchema],
    address: {
      line1: String,
      line2: String,
      city: String,
      state: String,
      pincode: String,
      phone: String,
    },
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    shippingFee: { type: Number, default: 0 },
    total: { type: Number, required: true },
    couponCode: { type: String },

    paymentMode: { type: String, enum: ['online', 'cod'], default: 'online' },
    paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },

    status: {
      type: String,
      enum: ['placed', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'],
      default: 'placed',
      index: true,
    },
    trackingId: { type: String },
    deliveredAt: { type: Date },
  },
  { timestamps: true }
);

orderSchema.pre('save', function (next) {
  if (!this.orderCode) this.orderCode = `ORD${Date.now().toString().slice(-8)}`;
  next();
});

module.exports = mongoose.model('Order', orderSchema);
