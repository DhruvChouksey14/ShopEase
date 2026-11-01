const { timingSafeEqual } = require('../../../../shared/utils/timingSafeEqual');

function internalAuth(req, res, next) {
     if (!timingSafeEqual(req.get('x-internal-service-key'), process.env.INTERNAL_SERVICE_KEY)) {
          return res.status(403).json({ success: false, message: 'Gateway authentication required' });
     }
     next();
}
function requireUser(req, res, next) {
     const userId = req.get('x-user-id');
     if (!userId) return res.status(401).json({ success: false, message: 'Sign in to use chat' });
     req.user = { id: userId };
     next();
}
module.exports = { internalAuth, requireUser };
