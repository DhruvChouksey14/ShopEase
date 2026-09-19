require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { config } = require('./config');
const { createMetrics } = require('../../../shared/middlewares/metrics');
const { errorHandler } = require('../../../shared/middlewares/errorHandler');

const cartRoutes = require('./routes/cart.route');
const { corsMiddleware } = require('./middlewares/cors.middleware');
const { RedisClient } = require('./config/redis');

const app = express();
const { metricsMiddleware, metricsHandler } = createMetrics('cart-service');

app.use(corsMiddleware);
app.use(helmet({ crossOriginOpenerPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json());
app.use(cookieParser());
app.use(metricsMiddleware);

app.get('/health', (req, res) => {
     res.status(200).json({ success: true, message: 'Cart Service is healthy', redisReady: RedisClient.isReady(), timestamp: new Date().toISOString() });
});
app.get('/metrics', metricsHandler);

app.use('/', cartRoutes);

app.use(errorHandler);

const server = app.listen(config.PORT, () => {
     console.log(`${config.SERVICE_NAME} is running on port ${config.PORT}`);
});

const shutdown = async () => {
     console.log('Shutting down gracefully...');
     server.close(async () => {
          await RedisClient.closeConnection();
          console.log('Server closed');
          process.exit(0);
     });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = app;
