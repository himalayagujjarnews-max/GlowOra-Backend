/**
 * Staff — a stylist working at a salon. Optionally linked to a User account
 * (role 'staff') so they can log into the partner app.
 */
const mongoose = require('mongoose');

const staffSchema = new mongoose.Schema(
  {
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // login account, optional
    name: { type: String, required: true, trim: true },
    phone: { type: String, match: [/^[6-9]\d{9}$/, 'Enter a valid mobile number'] },
    avatar: { type: String },
    specialities: [{ type: String }], // e.g. ['hair', 'beard']
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0 },
    status: { type: String, enum: ['available', 'busy', 'leave', 'inactive'], default: 'available' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Staff', staffSchema);
