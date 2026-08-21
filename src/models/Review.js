/**
 * Review — a customer's rating of a salon AFTER a completed booking. `rating`
 * is the salon rating; `staffRating` is a separate, independent rating for
 * the assigned stylist (only meaningful when the booking had a staff member).
 * One review per booking.
 */
const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    staff: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },       // salon rating
    staffRating: { type: Number, min: 1, max: 5 },                  // separate stylist rating
    comment: { type: String, maxlength: 500 },
    images: [{ type: String }], // before/after photos
    reply: { type: String, maxlength: 500 }, // salon's response
  },
  { timestamps: true }
);

/**
 * Recalculate the salon's average rating after a review is saved or removed.
 */
reviewSchema.statics.syncSalonRating = async function (salonId) {
  const agg = await this.aggregate([
    { $match: { salon: salonId } },
    { $group: { _id: '$salon', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const Salon = mongoose.model('Salon');
  if (agg.length) {
    await Salon.findByIdAndUpdate(salonId, {
      rating: Math.round(agg[0].avg * 10) / 10,
      reviewCount: agg[0].count,
    });
  } else {
    await Salon.findByIdAndUpdate(salonId, { rating: 0, reviewCount: 0 });
  }
};

/**
 * Recalculate a stylist's average rating from `staffRating` values only
 * (independent of the salon's own rating).
 */
reviewSchema.statics.syncStaffRating = async function (staffId) {
  if (!staffId) return;
  const agg = await this.aggregate([
    { $match: { staff: staffId, staffRating: { $exists: true, $ne: null } } },
    { $group: { _id: '$staff', avg: { $avg: '$staffRating' }, count: { $sum: 1 } } },
  ]);
  const Staff = mongoose.model('Staff');
  if (agg.length) {
    await Staff.findByIdAndUpdate(staffId, {
      rating: Math.round(agg[0].avg * 10) / 10,
      reviewCount: agg[0].count,
    });
  } else {
    await Staff.findByIdAndUpdate(staffId, { rating: 0, reviewCount: 0 });
  }
};

reviewSchema.post('save', function () {
  this.constructor.syncSalonRating(this.salon);
  if (this.staff) this.constructor.syncStaffRating(this.staff);
});

module.exports = mongoose.model('Review', reviewSchema);
