const { config } = require('../config');
const { ForbiddenError } = require('../utils/error');
const { timingSafeEqual } = require('../../../../shared/utils/timingSafeEqual');

const internalAuth = (req, res, next) => {
     const serviceKey = req.headers['x-internal-service-key'];
     if (!timingSafeEqual(serviceKey, config.INTERNAL_SERVICE_KEY)) {
          throw new ForbiddenError('Invalid or missing internal service key');
     }
     next();
};

module.exports = { internalAuth };
