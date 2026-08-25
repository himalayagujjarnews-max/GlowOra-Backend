/**
 * CustomerNote — free-text CRM notes an owner/staff member keeps about a
 * customer of their salon (e.g. "allergic to keratin", "prefers window
 * seat"). A salon can have several notes per customer over time, so this
 * is intentionally NOT unique per salon+customer — just indexed for fast
 * per-customer lookups.
 */
const mongoose = require('mongoose');

const customerNoteSchema = new mongoose.Schema(
  {
    salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    note: { type: String, required: true, maxlength: 500, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // the owner/staff who wrote it
  },
  { timestamps: true }
);

// Notes are always queried per salon+customer pair — compound index speeds that up.
customerNoteSchema.index({ salon: 1, customer: 1 });

module.exports = mongoose.model('CustomerNote', customerNoteSchema);
