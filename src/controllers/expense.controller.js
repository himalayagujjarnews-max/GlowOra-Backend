/**
 * Expense controller — owner-logged salon expenses (rent, products, etc.)
 * and a profit/loss summary combining them with completed-booking revenue.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const Expense = require('../models/Expense');
const Booking = require('../models/Booking');
const Salon = require('../models/Salon');

async function assertOwns(user, salonId) {
  const salon = await Salon.findById(salonId);
  if (!salon) throw ApiError.notFound('Salon not found');
  if (salon.owner.toString() !== user._id.toString() && user.role !== 'admin') {
    throw ApiError.forbidden('Not your salon');
  }
  return salon;
}

// Shared date-range resolver — default to the current calendar month, same
// default window used elsewhere (e.g. analytics.controller.js's dashboard).
function resolveRange(query) {
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const from = query.from ? new Date(query.from) : monthStart;
  const to = query.to ? new Date(query.to) : new Date();
  return { from, to };
}

// GET /api/v1/expenses?salon=&from=&to=  (owner/admin)
exports.list = asyncHandler(async (req, res) => {
  const { salon } = req.query;
  if (!salon) throw ApiError.badRequest('salon query param required');
  await assertOwns(req.user, salon);
  const { from, to } = resolveRange(req.query);
  const expenses = await Expense.find({ salon, date: { $gte: from, $lte: to } }).sort({ date: -1 });
  sendResponse(res, 200, 'Expenses', { count: expenses.length, expenses });
});

// POST /api/v1/expenses  { salon, category, amount, note?, date? }  (owner/admin)
exports.create = asyncHandler(async (req, res) => {
  const { salon, category, amount, note, date } = req.body;
  if (!salon || !category || amount === undefined) throw ApiError.badRequest('salon, category and amount are required');
  await assertOwns(req.user, salon);
  const expense = await Expense.create({ salon, category, amount, note, date, createdBy: req.user._id });
  sendResponse(res, 201, 'Expense added', { expense });
});

// DELETE /api/v1/expenses/:id  (owner/admin)
exports.remove = asyncHandler(async (req, res) => {
  const expense = await Expense.findById(req.params.id);
  if (!expense) throw ApiError.notFound('Expense not found');
  await assertOwns(req.user, expense.salon);
  await expense.deleteOne();
  sendResponse(res, 200, 'Expense removed');
});

// GET /api/v1/expenses/summary?salon=&from=&to=  (owner/admin)
// Real profit/loss: revenue from completed bookings in the range (same query
// shape as analytics.controller.js's dashboard monthAgg) minus expenses
// logged in that same range, broken down by category.
exports.summary = asyncHandler(async (req, res) => {
  const { salon } = req.query;
  if (!salon) throw ApiError.badRequest('salon query param required');
  const salonDoc = await assertOwns(req.user, salon);
  const { from, to } = resolveRange(req.query);

  const [revenueAgg, expenseAgg] = await Promise.all([
    Booking.aggregate([
      { $match: { salon: salonDoc._id, status: 'completed', completedAt: { $gte: from, $lte: to } } },
      { $group: { _id: null, revenue: { $sum: '$total' } } },
    ]),
    Expense.aggregate([
      { $match: { salon: salonDoc._id, date: { $gte: from, $lte: to } } },
      { $group: { _id: '$category', total: { $sum: '$amount' } } },
    ]),
  ]);

  const revenue = revenueAgg[0]?.revenue || 0;
  const byCategory = Object.fromEntries(expenseAgg.map((e) => [e._id, e.total]));
  const totalExpenses = expenseAgg.reduce((sum, e) => sum + e.total, 0);

  sendResponse(res, 200, 'Profit & loss summary', {
    from, to, revenue, totalExpenses, netProfit: revenue - totalExpenses, byCategory,
  });
});
