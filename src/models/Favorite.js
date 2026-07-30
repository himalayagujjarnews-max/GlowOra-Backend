/**
 * Favorite — customer's saved salons.
 */
const mongoose = require('mongoose');

const favoriteSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true },
  },
  { timestamps: true }
);

favoriteSchema.index({ user: 1, salon: 1 }, { unique: true });

module.exports = mongoose.model('Favorite', favoriteSchema);
