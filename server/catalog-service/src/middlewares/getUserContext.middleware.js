const { UnauthorizedError, ForbiddenError } = require('../utils/error');

/**
 * Extract user context from gateway headers
 * Gateway sets x-user-id after JWT verification(We have discussed this in video)
 */
function getUserContext(req, res, next) {
     const userId = req.headers['x-user-id'];
     const role = req.headers['x-user-role'];

     if (!userId || !role) {
          return next(new UnauthorizedError('User context missing - must come through gateway'));
     }

     req.user = { id: userId, role };
     next();
}

function requireAdmin(req, res, next) {
     if (req.user?.role !== 'ADMIN') {
          return next(new ForbiddenError('Administrator access is required', 'ADMIN_REQUIRED'));
     }

     next();
}

module.exports = { getUserContext, requireAdmin };
