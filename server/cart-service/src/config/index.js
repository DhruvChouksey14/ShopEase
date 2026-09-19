const config = {
     PORT: Number(process.env.PORT) || 4008,
     SERVICE_NAME: require('../../package.json').name,
     NODE_ENV: process.env.NODE_ENV || 'development',
     LOG_LEVEL: process.env.LOG_LEVEL || 'info',
     REDIS_URL: process.env.REDIS_URL,
     ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
     CATALOG_SERVICE_URL: process.env.CATALOG_SERVICE_URL || 'http://localhost:4003',
     INTERNAL_SERVICE_KEY: process.env.INTERNAL_SERVICE_KEY,
     CART_TTL_SECONDS: parseInt(process.env.CART_TTL_SECONDS || '2592000', 10),
}

module.exports = { config };
