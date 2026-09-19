require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const { config } = require('./config');
const cookieParser = require('cookie-parser');

const { corsMiddleware } = require('./middlewares/cors.middleware');
const { disconnectProducer } = require('./config/kafka');
const { createMetrics } = require('../../../shared/middlewares/metrics');
const { errorHandler } = require('../../../shared/middlewares/errorHandler');

const prisma = require('./config/prisma');
const paymentRoutes = require('./routes/payment.route');
const webhookRoutes = require('./routes/webhook.route');

const app = express();
const { metricsMiddleware, metricsHandler } = createMetrics('payment-service');

app.use(corsMiddleware);
app.use(metricsMiddleware);
app.use(helmet({
     crossOriginOpenerPolicy: false,
     crossOriginEmbedderPolicy: false
}));
// Webhook routes MUST be registered before express.json()
// because they need raw body for signature verification
app.use(webhookRoutes);

// JSON parsing for all other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get("/", (req, res) => {
     res.send("Hello from payment-service");
})

// Health check (includes PostgreSQL)
app.get('/health', async (req, res) => {
     let dbHealthy = false;
     try {
          await prisma.$queryRaw`SELECT 1`;
          dbHealthy = true;
     } catch (e) {
          console.error('Health check: DB unreachable', { error: e.message });
     }

     res.status(dbHealthy ? 200 : 503).json({
          success: dbHealthy,
          message: dbHealthy ? 'Payment Service is healthy' : 'Payment Service is degraded',
          database: dbHealthy,
          timestamp: new Date().toISOString(),
     });
});

app.get('/metrics', metricsHandler);

// API Routes
app.use(paymentRoutes);

app.use(errorHandler);

// Error handler (must be last)
const startServer = async () => {
     try {
          const server = app.listen(config.PORT, () => {
               console.log(
                    `${config.SERVICE_NAME} is running on port ${config.PORT}`
               );
          });

          // Graceful shutdown
          const shutdown = async () => {
               console.log('Shutting down gracefully...');
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
