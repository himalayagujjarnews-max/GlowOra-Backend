/**
 * Product & ProductCategory controller — GlowOra Shop catalog.
 */
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const sendResponse = require('../utils/ApiResponse');
const { getPagination, buildMeta } = require('../utils/pagination');
const { uploadImage } = require('../config/cloudinary');
const Product = require('../models/Product');
const ProductCategory = require('../models/ProductCategory');

// ---- Categories ----
// GET /shop/categories  (public)
exports.listCategories = asyncHandler(async (req, res) => {
  const categories = await ProductCategory.find({ active: true }).sort({ order: 1, name: 1 });
  sendResponse(res, 200, 'Categories', { categories });
});

// POST /shop/categories  (admin)
exports.createCategory = asyncHandler(async (req, res) => {
  if (!req.body.name) throw ApiError.badRequest('name is required');
  const category = await ProductCategory.create(req.body);
  sendResponse(res, 201, 'Category created', { category });
});

// PATCH /shop/categories/:id  (admin)
exports.updateCategory = asyncHandler(async (req, res) => {
  const category = await ProductCategory.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!category) throw ApiError.notFound('Category not found');
  sendResponse(res, 200, 'Category updated', { category });
});

// ---- Products ----
// GET /shop/products?category=&q=&featured=&sort=&page=  (public)
exports.listProducts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = { active: true };
  if (req.query.category) filter.category = req.query.category;
  if (req.query.featured === 'true') filter.isFeatured = true;
  if (req.query.q) filter.$text = { $search: req.query.q };

  let sort = { createdAt: -1 };
  if (req.query.sort === 'price_asc') sort = { price: 1 };
  else if (req.query.sort === 'price_desc') sort = { price: -1 };
  else if (req.query.sort === 'rating') sort = { rating: -1 };

  const [products, total] = await Promise.all([
    Product.find(filter).populate('category', 'name').sort(sort).skip(skip).limit(limit),
    Product.countDocuments(filter),
  ]);
  sendResponse(res, 200, 'Products', { products }, buildMeta(page, limit, total));
});

// GET /shop/products/:id  (public)
exports.getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id).populate('category', 'name');
  if (!product || !product.active) throw ApiError.notFound('Product not found');
  sendResponse(res, 200, 'Product', { product });
});

// POST /shop/products  (admin, multipart: images[])
exports.createProduct = asyncHandler(async (req, res) => {
  const { name, category, price, mrp } = req.body;
  if (!name || !category || price == null || mrp == null) {
    throw ApiError.badRequest('name, category, price and mrp are required');
  }
  let images = req.body.images || [];
  if (req.files && req.files.length) {
    const up = await Promise.all(req.files.map((f) => uploadImage(f.buffer, 'glowora/products')));
    images = up.map((u) => u.url);
  }
  const product = await Product.create({ ...req.body, images });
  sendResponse(res, 201, 'Product created', { product });
});

// PATCH /shop/products/:id  (admin)
exports.updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!product) throw ApiError.notFound('Product not found');
  sendResponse(res, 200, 'Product updated', { product });
});

// DELETE /shop/products/:id  (admin)
exports.deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  if (!product) throw ApiError.notFound('Product not found');
  sendResponse(res, 200, 'Product removed');
});
