/**
 * FamilyMember — people a customer can book for (spouse, kids, parents).
 */
const mongoose = require('mongoose');

const familyMemberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    relation: { type: String, enum: ['spouse', 'child', 'parent', 'sibling', 'friend', 'other'], default: 'other' },
    gender: { type: String, enum: ['male', 'female', 'other'] },
    age: { type: Number, min: 0, max: 120 },
    phone: { type: String, match: [/^[6-9]\d{9}$/, 'Enter a valid mobile number'] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FamilyMember', familyMemberSchema);
