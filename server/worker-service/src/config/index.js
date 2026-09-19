const config = {
     PORT: Number(process.env.PORT) || 4009,
     SERVICE_NAME: require('../../package.json').name,
     NODE_ENV: process.env.NODE_ENV || 'development',
     LOG_LEVEL: process.env.LOG_LEVEL || 'info',
     RABBITMQ_URL: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
     USER_SERVICE_URL: process.env.USER_SERVICE_URL || 'http://localhost:4001',
     INTERNAL_SERVICE_KEY: process.env.INTERNAL_SERVICE_KEY,
};

module.exports = { config };
