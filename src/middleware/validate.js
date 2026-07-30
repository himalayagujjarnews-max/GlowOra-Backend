/**
 * express-validator result checker.
 * Use after a chain of validation rules in a route.
 */
const { validationResult } = require('express-validator');
const ApiError = require('../utils/ApiError');

module.exports = function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const details = errors.array().map((e) => `${e.path}: ${e.msg}`);
    return next(ApiError.badRequest('Validation failed', details));
  }
  next();
};
