/**
 * FavoriteStaff — customer's saved/favorited stylists. Kept as its own
 * collection (mirrors Favorite.js for salons) rather than an array on User,
 * since a favorited stylist may work at a salon the customer hasn't
 * necessarily favorited separately.
 */
const mongoose = require('mongoose');

const favoriteStaffSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    staff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', required: true },
  },
  { timestamps: true }
);

favoriteStaffSchema.index({ user: 1, staff: 1 }, { unique: true });

module.exports = mongoose.model('FavoriteStaff', favoriteStaffSchema);
