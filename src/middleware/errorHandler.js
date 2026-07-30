/**
 * Global error handler + 404 handler.
 * Converts Mongoose/JWT errors into clean ApiError responses.
 */
const ApiError = require('../utils/ApiError');
const config = require('../config/env');
const logger = require('../utils/logger');

function notFound(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let error = err;

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    error = ApiError.badRequest(`Invalid ${err.path}: ${err.value}`);
  }
  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    error = ApiError.conflict(`${field} already exists.`);
  }
  // Mongoose validation
  if (err.name === 'ValidationError') {
    const details = Object.values(err.errors).map((e) => e.message);
    error = ApiError.badRequest('Validation failed', details);
  }

  const statusCode = error.statusCode || 500;
  const message = error.isOperational ? error.message : 'Something went wrong';

  if (statusCode >= 500) logger.error(`${statusCode} ${req.method} ${req.originalUrl} — ${err.message}`);

  const body = { success: false, message };
  if (error.details) body.details = error.details;
  if (!config.isProd && statusCode >= 500) body.stack = err.stack;

  res.status(statusCode).json(body);
}

module.exports = { notFound, errorHandler };
