/**
 * Entry point — connects to DB/Redis, starts the HTTP + Socket.io server,
 * seeds the first admin, and handles graceful shutdown + crash safety.
 */
const http = require('http');
const app = require('./src/app');
const config = require('./src/config/env');
const connectDB = require('./src/config/db');
const { connectRedis } = require('./src/config/redis');
const { initSocket } = require('./src/socket');
const { startNotificationWorker } = require('./src/workers/notification.worker');
const seedAdmin = require('./src/utils/seedAdmin');
const seedData = require('./src/utils/seedData');
const scheduler = require('./src/services/scheduler.service');
const logger = require('./src/utils/logger');
const os = require('os');

// Get the machine's LAN IPv4 address (e.g. 192.168.1.8) so the API is reachable
// from phones/emulators on the same WiFi network, not just from this PC.
function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  process.exit(1);
});

async function start() {
  await connectDB();
  await connectRedis();
  await seedAdmin();
  await seedData();

  const server = http.createServer(app);
  await initSocket(server);      // attach Socket.io (+ Redis adapter if available)
  startNotificationWorker();     // consume the notification queue
  scheduler.start();             // background jobs: reminders, recurring bookings, expiry

  // Explicitly bind to 0.0.0.0 so the server accepts connections both via
  // "localhost" (same machine) AND via the machine's LAN IP (other devices
  // on the same WiFi, e.g. phones running the Expo app).
  server.listen(config.port, '0.0.0.0', () => {
    const lanIp = getLanIp();
    logger.info(`🚀 GlowOra API running in ${config.env} mode on port ${config.port}`);
    logger.info(`   Local:  http://localhost:${config.port}/api/v1`);
    if (lanIp) {
      logger.info(`   LAN:    http://${lanIp}:${config.port}/api/v1  (use this in mobile app's src/api/config.js)`);
    } else {
      logger.info('   LAN:    could not detect a LAN IPv4 address — check your network connection');
    }
    logger.info(`   Health: http://localhost:${config.port}/health`);
    logger.info(`   Socket: ws://localhost:${config.port}`);
  });

  process.on('unhandledRejection', (err) => {
    logger.error(`Unhandled Rejection: ${err.message}`);
    server.close(() => process.exit(1));
  });
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Shutting down gracefully…');
    server.close(() => process.exit(0));
  });
}

start();
