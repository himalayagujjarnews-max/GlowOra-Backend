/**
 * Granular permission layer on top of roles.
 * Each role maps to a set of permission strings; routes can require a
 * specific permission via requirePermission('booking:cancel').
 *
 * This keeps RBAC extensible for the future (e.g. sub-admins, managers)
 * without rewriting every route guard.
 */
const ApiError = require('../utils/ApiError');

const ROLE_PERMISSIONS = {
  admin: ['*'], // superuser
  owner: [
    'salon:manage', 'service:manage', 'package:manage', 'staff:manage',
    'slot:manage', 'booking:view', 'booking:manage', 'offer:manage',
    'payout:view', 'analytics:view', 'review:reply', 'attendance:manage',
  ],
  staff: ['booking:view', 'booking:complete', 'attendance:self', 'chat:use', 'call:use'],
  customer: [
    'booking:create', 'booking:cancel', 'booking:reschedule', 'review:create',
    'wallet:use', 'chat:use', 'call:use', 'favorite:manage', 'address:manage',
    'family:manage', 'order:create',
  ],
};

function hasPermission(role, permission) {
  const perms = ROLE_PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(permission);
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (hasPermission(req.user.role, permission)) return next();
    return next(ApiError.forbidden(`Missing permission: ${permission}`));
  };
}

module.exports = { ROLE_PERMISSIONS, hasPermission, requirePermission };
