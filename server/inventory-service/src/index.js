require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { config } = require('./config');
const { createMetrics } = require('../../../shared/middlewares/metrics');
const { errorHandler } = require('../../../shared/middlewares/errorHandler');

const inventoryRoutes = require('./routes/inventory.route');
const { corsMiddleware } = require('./middlewares/cors.middleware');
const { disconnectProducer } = require('./config/kafka');
const inventoryConsumer = require('./kafka/consumer/inventory.consumer');
const inventoryService = require('./services/inventory.service');

const app = express();
const { metricsMiddleware, metricsHandler } = createMetrics('inventory-service');

app.use(corsMiddleware);
app.use(helmet({ crossOriginOpenerPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(metricsMiddleware);

app.get('/health', (req, res) => {
     res.status(200).json({ success: true, message: 'Inventory Service is healthy', timestamp: new Date().toISOString() });
});
app.get('/metrics', metricsHandler);

app.use('/', inventoryRoutes);

app.use(errorHandler);

let expirySweepInterval;

const startServer = async () => {
     try {
          await inventoryConsumer.start();

          // Background job: reap abandoned stock holds whose order never completed checkout.
          expirySweepInterval = setInterval(() => {
               inventoryService.sweepExpiredReservations().catch((err) =>
                    console.error('Reservation sweep failed', { error: err.message })
               );
          }, config.LOCK_EXPIRY_INTERVAL_MS);

          const server = app.listen(config.PORT, () => {
               console.log(`${config.SERVICE_NAME} is running on port ${config.PORT}`);
          });

          const shutdown = async () => {
               console.log('Shutting down gracefully...');
               clearInterval(expirySweepInterval);
               server.close(async () => {
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
