/**
 * Auth middleware.
 *  - protect: verifies the access token and attaches req.user.
 *  - restrictTo(...roles): guards routes by role.
 */
const { verifyAccessToken } = require('../utils/jwt');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/User');
const Session = require('../models/Session');

const protect = asyncHandler(async (req, res, next) => {
  let token;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    token = header.split(' ')[1];
  } else if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) throw ApiError.unauthorized('You are not logged in. Please log in to continue.');

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch (err) {
    throw ApiError.unauthorized(
      err.name === 'TokenExpiredError' ? 'Session expired. Please log in again.' : 'Invalid token.'
    );
  }

  const user = await User.findById(decoded.id).select('+active');
  if (!user) throw ApiError.unauthorized('The user for this token no longer exists.');
  if (user.active === false) throw ApiError.forbidden('Your account has been blocked.');

  // If the token references a session, ensure that session is still valid.
  if (decoded.sid) {
    const session = await Session.findById(decoded.sid).select('revoked');
    if (session && session.revoked) throw ApiError.unauthorized('This session has been logged out.');
    user.sid = decoded.sid;
  }

  req.user = user;
  next();
});

const restrictTo = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(ApiError.forbidden('You do not have permission to perform this action.'));
  }
  next();
};

module.exports = { protect, restrictTo };
