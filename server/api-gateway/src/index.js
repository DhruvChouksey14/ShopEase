require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const { config } = require('./config');
const { corsMiddleware } = require('./middlewares/cors.middleware');
const routes = require('./routes');
const { createMetrics } = require('../../../shared/middlewares/metrics');
const app = express();
const { metricsMiddleware, metricsHandler } = createMetrics('api-gateway');

app.use(corsMiddleware);
app.use(metricsMiddleware);
app.use(helmet({
     crossOriginOpenerPolicy: false,
     crossOriginEmbedderPolicy: false,
}));
// Skip JSON parsing for Razorpay webhook — signature verification needs raw bytes
app.use((req, res, next) => {
     if (req.path === '/api/payments/webhooks/razorpay') {
          return express.raw({ type: 'application/json', limit: '10mb' })(req, res, next);
     }
     express.json({ limit: '10mb' })(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

if (config.NODE_ENV === 'development') {
     app.use(morgan('dev'));
}

app.get('/health', (req, res) => {
     res.status(200).json({
          success: true,
          message: 'API Gateway is running',
          timestamp: new Date().toISOString(),
          environment: config.NODE_ENV,
     });
});

app.get('/metrics', metricsHandler);

app.use('/api', routes);
const gracefulShutdown = () => {
     console.log('Received shutdown signal, closing server gracefully...');
     server.close(() => {
          console.log('Server closed');
          process.exit(0);
     });

     setTimeout(() => {
          console.error('Forced shutdown after timeout');
          process.exit(1);
     }, 30000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

const server = app.listen(config.PORT, () => {
     console.log(`🚀 API Gateway running on port ${config.PORT} in ${config.NODE_ENV} mode`);
});

process.on('unhandledRejection', (err) => {
     console.error('Unhandled Rejection:', err);
     server.close(() => process.exit(1));
});

module.exports = app;