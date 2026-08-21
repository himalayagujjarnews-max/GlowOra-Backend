/**
 * CustomerReview — the reverse of Review: a salon owner or staff member
 * rating the CUSTOMER after a completed booking (reliability, behaviour,
 * etc.), with an optional comment. Helps salons vet home-service requests
 * from a customer's history. One review per booking.
 */
const mongoose = require('mongoose');

const customerReviewSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ratedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // owner or staff user
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, maxlength: 500 },
  },
  { timestamps: true }
);

/**
 * Recalculate a customer's average rating (as seen by salons) after a
 * customer review is saved or removed.
 */
customerReviewSchema.statics.syncCustomerRating = async function (customerId) {
  const agg = await this.aggregate([
    { $match: { customer: customerId } },
    { $group: { _id: '$customer', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const User = mongoose.model('User');
  if (agg.length) {
    await User.findByIdAndUpdate(customerId, {
      customerRating: Math.round(agg[0].avg * 10) / 10,
      customerRatingCount: agg[0].count,
    });
  } else {
    await User.findByIdAndUpdate(customerId, { customerRating: 0, customerRatingCount: 0 });
  }
};

customerReviewSchema.post('save', function () {
  this.constructor.syncCustomerRating(this.customer);
});

module.exports = mongoose.model('CustomerReview', customerReviewSchema);
