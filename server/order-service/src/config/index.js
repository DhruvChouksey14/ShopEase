const config = {
     PORT: Number(process.env.PORT) || 4005,
     SERVICE_NAME: require('../../package.json').name,
     NODE_ENV: process.env.NODE_ENV || 'development',
     LOG_LEVEL: process.env.LOG_LEVEL || 'info',
     KAFKA_BROKER: process.env.KAFKA_BROKER,
     KAFKA_CLIENT_ID: process.env.KAFKA_CLIENT_ID || 'order-service',
     DATABASE_URL: process.env.DATABASE_URL,
     ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
     REDIS_URL: process.env.REDIS_URL,

     // Inter-service communication
     INVENTORY_SERVICE_URL: process.env.INVENTORY_SERVICE_URL || 'http://localhost:4007',
     PAYMENT_SERVICE_URL: process.env.PAYMENT_SERVICE_URL || 'http://localhost:4006',
     USER_SERVICE_URL: process.env.USER_SERVICE_URL || 'http://localhost:4001',
     CATALOG_SERVICE_URL: process.env.CATALOG_SERVICE_URL || 'http://localhost:4003',
     CART_SERVICE_URL: process.env.CART_SERVICE_URL || 'http://localhost:4008',
     INTERNAL_SERVICE_KEY: process.env.INTERNAL_SERVICE_KEY,

     // Needed to verify JWTs on WebSocket handshake (must match user-service's secret)
     JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,

     // Order / stock-hold TTL
     ORDER_TTL_SECONDS: parseInt(process.env.ORDER_TTL_SECONDS || '600', 10),
     ORDER_EXPIRY_CHECK_INTERVAL_MS: parseInt(process.env.ORDER_EXPIRY_CHECK_INTERVAL_MS || '30000', 10),

     // RabbitMQ (invoice generation background job)
     RABBITMQ_URL: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
}

module.exports = { config };
