/**
 * Express application — security middleware, routes, error handling.
 * Kept separate from server.js so it can be imported in tests.
 */
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');

const config = require('./config/env');
const { apiLimiter } = require('./middleware/rateLimiter');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const requestId = require('./middleware/requestId');
const locale = require('./middleware/locale');
const audit = require('./middleware/audit');
const routes = require('./routes');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// gzip responses — smaller payloads, faster under load
app.use(compression());

// Request tracing (first, so everything downstream has req.id)
app.use(requestId);

// Security headers — strict CSP + HSTS for production
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginResourcePolicy: { policy: 'same-site' },
  })
);

// CORS — allow the three known frontends
const allowedOrigins = [config.cors.customerUrl, config.cors.partnerUrl, config.cors.adminUrl];
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  })
);

// Razorpay webhook needs the raw body for signature verification.
app.use(
  express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
      if (req.originalUrl.includes('/payments/webhook')) req.rawBody = buf.toString();
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser(config.cookieSecret));

// Sanitisation
app.use(mongoSanitize());
app.use(xss());
app.use(hpp());

// Localisation context
app.use(locale);

// Logging (include request id)
morgan.token('id', (req) => req.id);
app.use(morgan(config.isProd ? ':id :method :url :status :response-time ms' : 'dev'));

// Rate limiting on the API surface
app.use('/api', apiLimiter);

// Audit trail for mutating requests
app.use('/api', audit);

// Health check
app.get('/health', (req, res) => res.json({ success: true, status: 'ok', uptime: process.uptime(), requestId: req.id }));

// API routes
app.use('/api/v1', routes);

// 404 + error handler (must be last)
app.use(notFound);
app.use(errorHandler);

module.exports = app;
