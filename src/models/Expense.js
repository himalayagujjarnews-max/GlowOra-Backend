/**
 * Expense — an owner-logged salon expense (rent, products, utilities, etc.)
 * used to compute real profit/loss alongside booking revenue.
 */
const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema(
  {
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    category: { type: String, enum: ['rent', 'products', 'utilities', 'salaries', 'marketing', 'other'], required: true },
    amount: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true, maxlength: 200 },
    date: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Expense', expenseSchema);
