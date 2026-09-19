require('dotenv').config();
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { config } = require('./config');
const { createMetrics } = require('../../../shared/middlewares/metrics');
const { errorHandler } = require('../../../shared/middlewares/errorHandler');

const orderRoutes = require('./routes/order.route');
const { corsMiddleware } = require('./middlewares/cors.middleware');
const { disconnectProducer } = require('./config/kafka');
const orderConsumer = require('./kafka/consumer/order.consumer');
const orderService = require('./services/order.service');
const { initSocketServer } = require('./sockets/io');

const app = express();
const { metricsMiddleware, metricsHandler } = createMetrics('order-service');

app.use(corsMiddleware);
app.use(helmet({ crossOriginOpenerPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(metricsMiddleware);

app.get('/health', (req, res) => {
     res.status(200).json({ success: true, message: 'Order Service is healthy', timestamp: new Date().toISOString() });
});
app.get('/metrics', metricsHandler);

app.use('/', orderRoutes);

app.use(errorHandler);

const httpServer = http.createServer(app);
initSocketServer(httpServer);

let expiryInterval;

const startServer = async () => {
     try {
          await orderConsumer.start();

          expiryInterval = setInterval(() => {
               orderService.sweepExpiredOrders().catch((err) => console.error('Order expiry sweep failed', { error: err.message }));
          }, config.ORDER_EXPIRY_CHECK_INTERVAL_MS);

          httpServer.listen(config.PORT, () => {
               console.log(`${config.SERVICE_NAME} is running on port ${config.PORT} (HTTP + WebSocket)`);
          });

          const shutdown = async () => {
               console.log('Shutting down gracefully...');
               clearInterval(expiryInterval);
               httpServer.close(async () => {
                    await disconnectProducer();
                    console.log('Server closed');
                    process.exit(0);
               });
          };

          process.on('SIGTERM', shutdown);
          process.on('SIGINT', shutdown);
     } catch (error) {
          console.error('Failed to start server', error);
          process.exit(1);
     }
};

startServer();

module.exports = app;
