const { UnauthorizedError, ForbiddenError } = require('../utils/error');

/**
 * Extract user context from gateway headers.
 * The gateway verifies the JWT and forwards x-user-id / x-user-role downstream —
 * services never re-verify the token themselves (except the WebSocket handshake,
 * which connects directly and must verify the JWT itself — see sockets/io.js).
 */
function getUserContext(req, res, next) {
     const userId = req.headers['x-user-id'];
     const role = req.headers['x-user-role'];

     if (!userId) {
          return next(new UnauthorizedError('User context missing - must come through gateway'));
     }

     req.user = { id: userId, role: role || 'USER' };
     next();
}

function requireAdmin(req, res, next) {
     if (req.user?.role !== 'ADMIN') {
          return next(new ForbiddenError('Administrator access is required', 'ADMIN_REQUIRED'));
     }
     next();
}

module.exports = { getUserContext, requireAdmin };
