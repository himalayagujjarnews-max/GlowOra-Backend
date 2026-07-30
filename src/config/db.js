/**
 * MongoDB connection via Mongoose.
 */
const mongoose = require('mongoose');
const config = require('./env');
const logger = require('../utils/logger');

mongoose.set('strictQuery', true);

async function connectDB() {
  try {
    const conn = await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 10000,
      // connection pool — each server instance keeps a pool of DB sockets.
      // Tune per instance; with N instances your Atlas cluster sees N×maxPoolSize.
      maxPoolSize: parseInt(process.env.DB_MAX_POOL, 10) || 50,
      minPoolSize: parseInt(process.env.DB_MIN_POOL, 10) || 5,
      socketTimeoutMS: 45000,
    });
    logger.info(`✅ MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (err) {
    logger.error(`❌ MongoDB connection error: ${err.message}`);
    // Retry once after 5s, then exit so a process manager can restart.
    setTimeout(() => process.exit(1), 5000);
    throw err;
  }
}

mongoose.connection.on('disconnected', () => logger.warn('⚠️  MongoDB disconnected'));
mongoose.connection.on('reconnected', () => logger.info('✅ MongoDB reconnected'));

module.exports = connectDB;
