/**
 * ConsentForm — a digital consent/health form a customer submits before a
 * treatment the salon has flagged as risky (waxing, coloring, facials, etc.
 * — see Service.requiresConsent). One form per booking.
 */
const mongoose = require('mongoose');

const consentFormSchema = new mongoose.Schema(
  {
    booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service' },
    allergies: { type: String, maxlength: 500 },
    medicalConditions: { type: String, maxlength: 500 },
    // Must be true to submit — enforced in consentForm.controller.js (not
    // here) so the validation error message can be a friendly ApiError.
    hasReadTerms: { type: Boolean, required: true },
    signedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ConsentForm', consentFormSchema);
