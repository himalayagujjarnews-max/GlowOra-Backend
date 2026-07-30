/**
 * Demo / test data seeder — creates ready-to-use accounts + salons so you can
 * log in and click through the whole app without setting anything up by hand.
 *
 * Run it on demand (NOT on every boot):
 *     npm run seed:demo
 *
 * Idempotent: re-running updates the same demo records instead of duplicating
 * (matched by phone / owner).
 *
 * ── What it creates ─────────────────────────────────────────────────
 *   5 Customers   phones 9000000001 … 9000000005   (OTP login)
 *   5 Owners      phones 9000000011 … 9000000015   password: Owner@123 (or OTP)
 *   5 Staff       phones 9000000021 … 9000000025   (OTP login, linked to a salon)
 *   5 Salons      one per owner (Chandigarh / Mohali / Panchkula / Zirakpur / Ambala)
 *                 each with 4-5 services + 1 linked stylist
 *   ADMIN         phone 9999999999   password Admin@123  (seeded on boot)
 *
 *   OTP is NOT sent by SMS in dev — watch the SERVER terminal for:
 *       📩 [DEV] OTP for <phone> is XXXX
 * ────────────────────────────────────────────────────────────────────
 */
require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config/env');
const logger = require('./logger');
const { hashPassword } = require('./password');

const User = require('../models/User');
const Salon = require('../models/Salon');
const Service = require('../models/Service');
const Staff = require('../models/Staff');
const Product = require('../models/Product');
const ProductCategory = require('../models/ProductCategory');

const OWNER_PASSWORD = 'Owner@123';

// ── customers ──────────────────────────────────────────────
const CUSTOMERS = [
  { phone: '9000000001', name: 'Aarav Sharma', gender: 'male', city: 'Chandigarh', wallet: 500, points: 200 },
  { phone: '9000000002', name: 'Isha Verma', gender: 'female', city: 'Mohali', wallet: 250, points: 80 },
  { phone: '9000000003', name: 'Rohan Gupta', gender: 'male', city: 'Panchkula', wallet: 0, points: 0 },
  { phone: '9000000004', name: 'Priya Singh', gender: 'female', city: 'Zirakpur', wallet: 1000, points: 450 },
  { phone: '9000000005', name: 'Kabir Mehta', gender: 'male', city: 'Ambala', wallet: 120, points: 30 },
];

// ── salons (each owned by one owner, served by one staff) ──
// coords: [lng, lat]
const SALONS = [
  {
    owner: { phone: '9000000011', name: 'Vikram Anand' },
    staff: { phone: '9000000021', name: 'Simran Kaur', specialities: ['hair', 'spa'] },
    salon: {
      name: 'Glow Luxe Studio', type: 'unisex', plan: 'pro', city: 'Chandigarh', state: 'Chandigarh',
      line: 'SCO 42, Sector 17', pincode: '160017', coordinates: [76.7794, 30.7333],
      rating: 4.7, reviewCount: 128, homeService: true,
    },
    services: [
      { name: 'Haircut & Styling', category: 'hair', forGender: 'unisex', price: 499, discountPrice: 399, durationMinutes: 45, homeServiceAvailable: true },
      { name: 'Gold Facial', category: 'face', forGender: 'female', price: 1499, discountPrice: 1199, durationMinutes: 60 },
      { name: 'Beard Grooming', category: 'beard', forGender: 'male', price: 299, durationMinutes: 30, homeServiceAvailable: true },
      { name: 'Hair Spa', category: 'spa', forGender: 'unisex', price: 899, discountPrice: 699, durationMinutes: 50 },
      { name: 'Bridal Makeup', category: 'bridal', forGender: 'female', price: 8999, durationMinutes: 120 },
    ],
  },
  {
    owner: { phone: '9000000012', name: 'Neha Kapoor' },
    staff: { phone: '9000000022', name: 'Ritu Bansal', specialities: ['makeup', 'face'] },
    salon: {
      name: 'Blush & Bloom', type: 'ladies', plan: 'basic', city: 'Mohali', state: 'Punjab',
      line: 'Phase 7, Industrial Area', pincode: '160055', coordinates: [76.7179, 30.7046],
      rating: 4.5, reviewCount: 86, homeService: true,
    },
    services: [
      { name: 'Party Makeup', category: 'makeup', forGender: 'female', price: 2499, durationMinutes: 75 },
      { name: 'Fruit Facial', category: 'face', forGender: 'female', price: 799, discountPrice: 649, durationMinutes: 45 },
      { name: 'Hair Colour', category: 'hair', forGender: 'female', price: 1799, durationMinutes: 90 },
      { name: 'Manicure', category: 'hands', forGender: 'female', price: 499, durationMinutes: 40, homeServiceAvailable: true },
    ],
  },
  {
    owner: { phone: '9000000013', name: 'Arjun Rana' },
    staff: { phone: '9000000023', name: 'Deepak Yadav', specialities: ['hair', 'beard'] },
    salon: {
      name: 'The Gentlemen Lounge', type: 'gents', plan: 'pro', city: 'Panchkula', state: 'Haryana',
      line: 'Sector 5, Main Market', pincode: '134109', coordinates: [76.8606, 30.6942],
      rating: 4.8, reviewCount: 152, homeService: false,
    },
    services: [
      { name: 'Premium Haircut', category: 'hair', forGender: 'male', price: 399, durationMinutes: 40 },
      { name: 'Beard Styling', category: 'beard', forGender: 'male', price: 249, durationMinutes: 25 },
      { name: 'Head Massage', category: 'spa', forGender: 'male', price: 599, discountPrice: 499, durationMinutes: 30 },
      { name: 'Clean-up Facial', category: 'face', forGender: 'male', price: 699, durationMinutes: 45 },
    ],
  },
  {
    owner: { phone: '9000000014', name: 'Sana Khan' },
    staff: { phone: '9000000024', name: 'Pooja Rani', specialities: ['nails', 'hands', 'feet'] },
    salon: {
      name: 'Serene Beauty Bar', type: 'unisex', plan: 'basic', city: 'Zirakpur', state: 'Punjab',
      line: 'VIP Road, Near Paras Downtown', pincode: '140603', coordinates: [76.8173, 30.6425],
      rating: 4.3, reviewCount: 61, homeService: true,
    },
    services: [
      { name: 'Gel Nail Extensions', category: 'nails', forGender: 'female', price: 1299, durationMinutes: 90 },
      { name: 'Pedicure Deluxe', category: 'feet', forGender: 'unisex', price: 799, discountPrice: 649, durationMinutes: 50, homeServiceAvailable: true },
      { name: 'Threading & Wax', category: 'face', forGender: 'female', price: 349, durationMinutes: 30 },
      { name: 'Unisex Haircut', category: 'hair', forGender: 'unisex', price: 449, durationMinutes: 40 },
      { name: 'Full Body Spa', category: 'body', forGender: 'unisex', price: 2999, durationMinutes: 120 },
    ],
  },
  {
    owner: { phone: '9000000015', name: 'Manish Joshi' },
    staff: { phone: '9000000025', name: 'Anjali Thakur', specialities: ['bridal', 'makeup', 'hair'] },
    salon: {
      name: 'Royal Mirror Salon', type: 'unisex', plan: 'free', city: 'Ambala', state: 'Haryana',
      line: 'Nicholson Road, Ambala Cantt', pincode: '133001', coordinates: [76.8340, 30.3782],
      rating: 4.1, reviewCount: 34, homeService: false,
    },
    services: [
      { name: 'Basic Haircut', category: 'hair', forGender: 'unisex', price: 199, durationMinutes: 30 },
      { name: 'Bridal Package', category: 'bridal', forGender: 'female', price: 11999, discountPrice: 9999, durationMinutes: 180 },
      { name: 'De-Tan Facial', category: 'face', forGender: 'unisex', price: 599, durationMinutes: 40 },
      { name: 'Hair Straightening', category: 'hair', forGender: 'female', price: 3499, durationMinutes: 120 },
    ],
  },
];

async function upsertUser(phone, data) {
  let user = await User.findOne({ phone });
  if (!user) user = await User.create({ phone, ...data });
  else { Object.assign(user, data); await user.save(); }
  return user;
}

async function seedDemo() {
  logger.info('🌱 Seeding demo data (5 customers, 5 salons, 5 staff)…');

  // 1) Customers
  for (const c of CUSTOMERS) {
    await upsertUser(c.phone, {
      name: c.name, role: 'customer', gender: c.gender, city: c.city,
      phoneVerified: true, walletBalance: c.wallet, glowPoints: c.points,
      location: { type: 'Point', coordinates: [76.7794, 30.7333] },
    });
  }

  const ownerPwd = await hashPassword(OWNER_PASSWORD);

  // 2) Salons + owners + staff + services
  for (const entry of SALONS) {
    const owner = await upsertUser(entry.owner.phone, {
      name: entry.owner.name, role: 'owner', city: entry.salon.city,
      phoneVerified: true, password: ownerPwd,
    });

    const staffUser = await upsertUser(entry.staff.phone, {
      name: entry.staff.name, role: 'staff', city: entry.salon.city, phoneVerified: true,
    });

    const salonData = {
      owner: owner._id,
      name: entry.salon.name,
      description: `${entry.salon.name} — premium ${entry.salon.type} salon in ${entry.salon.city}.`,
      type: entry.salon.type,
      address: { line: entry.salon.line, city: entry.salon.city, state: entry.salon.state, pincode: entry.salon.pincode },
      location: { type: 'Point', coordinates: entry.salon.coordinates },
      offersHomeService: entry.salon.homeService,
      homeServiceRadius: 8,
      openTime: '09:00', closeTime: '20:00', maxPerSlot: 2,
      subscriptionPlan: entry.salon.plan,
      status: 'active', // pre-approved for demo
      rating: entry.salon.rating, reviewCount: entry.salon.reviewCount,
    };
    let salon = await Salon.findOne({ owner: owner._id });
    if (!salon) salon = await Salon.create(salonData);
    else { Object.assign(salon, salonData); await salon.save(); }

    // services (reseed clean)
    await Service.deleteMany({ salon: salon._id });
    await Service.insertMany(entry.services.map((s) => ({ salon: salon._id, ...s })));

    // staff record linked to the staff user
    const staffData = {
      salon: salon._id, user: staffUser._id, name: entry.staff.name, phone: entry.staff.phone,
      specialities: entry.staff.specialities, rating: 4.6, reviewCount: 40, status: 'available', active: true,
    };
    let staff = await Staff.findOne({ salon: salon._id, user: staffUser._id });
    if (!staff) await Staff.create(staffData);
    else { Object.assign(staff, staffData); await staff.save(); }
  }

  // ── Shop: product categories + products ──
  const SHOP_CATS = [
    { name: 'Haircare', order: 1 },
    { name: 'Skincare', order: 2 },
    { name: 'Makeup', order: 3 },
    { name: 'Tools', order: 4 },
  ];
  const catMap = {};
  for (const c of SHOP_CATS) {
    let cat = await ProductCategory.findOne({ name: c.name });
    if (!cat) cat = await ProductCategory.create(c);
    catMap[c.name] = cat._id;
  }

  const PIMG = {
    hair: 'https://images.unsplash.com/photo-1631730486572-226d1f595b68?w=500&q=70',
    facial: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=500&q=70',
    nails: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=500&q=70',
    spa: 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=500&q=70',
  };
  const PRODUCTS = [
    { name: 'Argan Hair Serum', brand: 'GlowOra', cat: 'Haircare', price: 599, mrp: 799, unit: '100ml', rating: 4.6, img: PIMG.hair, featured: true },
    { name: 'Keratin Shampoo', brand: 'GlowOra', cat: 'Haircare', price: 449, mrp: 599, unit: '250ml', rating: 4.5, img: PIMG.hair },
    { name: 'Vitamin C Face Serum', brand: 'Glow Labs', cat: 'Skincare', price: 899, mrp: 1199, unit: '30ml', rating: 4.8, featured: true, img: PIMG.facial },
    { name: 'Aloe Moisturizer', brand: 'Glow Labs', cat: 'Skincare', price: 349, mrp: 499, unit: '100g', rating: 4.4, img: PIMG.facial },
    { name: 'Matte Lipstick', brand: 'BlushCo', cat: 'Makeup', price: 349, mrp: 499, unit: '1 pc', rating: 4.3, img: PIMG.nails },
    { name: 'Liquid Foundation', brand: 'BlushCo', cat: 'Makeup', price: 699, mrp: 999, unit: '30ml', rating: 4.5, img: PIMG.nails },
    { name: 'Hair Spa Cream', brand: 'GlowOra', cat: 'Haircare', price: 449, mrp: 599, unit: '200g', rating: 4.5, img: PIMG.spa },
    { name: 'Facial Roller', brand: 'GlowOra', cat: 'Tools', price: 299, mrp: 499, unit: '1 pc', rating: 4.2, img: PIMG.spa },
  ];
  await Product.deleteMany({ sellerName: 'GlowOra Demo' });
  for (const p of PRODUCTS) {
    const exists = await Product.findOne({ name: p.name });
    const doc = {
      name: p.name, brand: p.brand, category: catMap[p.cat], price: p.price, mrp: p.mrp,
      unit: p.unit, rating: p.rating, reviewCount: 20, stock: 100, active: true,
      isFeatured: !!p.featured, images: p.img ? [p.img] : [], sellerType: 'glowora', sellerName: 'GlowOra Demo',
      description: `${p.name} by ${p.brand} — premium salon-grade quality.`,
    };
    if (!exists) await Product.create(doc);
    else { Object.assign(exists, doc); await exists.save(); }
  }

  logger.info('✅ Demo data seeded successfully!');
  logger.info('════════════════════════════════════════════════════');
  logger.info('  CUSTOMERS (OTP login):');
  CUSTOMERS.forEach((c) => logger.info(`     ${c.phone}  ·  ${c.name}  (${c.city})`));
  logger.info('  ─────────────────────────────────────────────');
  logger.info(`  OWNERS (password ${OWNER_PASSWORD}, or OTP):`);
  SALONS.forEach((s) => logger.info(`     ${s.owner.phone}  ·  ${s.owner.name}  →  ${s.salon.name}`));
  logger.info('  ─────────────────────────────────────────────');
  logger.info('  STAFF (OTP login):');
  SALONS.forEach((s) => logger.info(`     ${s.staff.phone}  ·  ${s.staff.name}  @  ${s.salon.name}`));
  logger.info('  ─────────────────────────────────────────────');
  logger.info('  ADMIN   9999999999  ·  password Admin@123');
  logger.info('════════════════════════════════════════════════════');
  logger.info('  OTP is NOT sent by SMS in dev — watch this terminal for:');
  logger.info('  📩 [DEV] OTP for <phone> is XXXX');
  logger.info('════════════════════════════════════════════════════');
}

// Standalone runner: `npm run seed:demo`
if (require.main === module) {
  (async () => {
    try {
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 });
      logger.info('✅ Connected to MongoDB for seeding');
      await seedDemo();
      await mongoose.disconnect();
      process.exit(0);
    } catch (err) {
      logger.error(`❌ Demo seed failed: ${err.message}`);
      process.exit(1);
    }
  })();
}

module.exports = seedDemo;
