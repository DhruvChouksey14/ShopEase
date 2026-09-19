require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const { config } = require('./config');
const cookieParser = require('cookie-parser');
const { createMetrics } = require('../../../shared/middlewares/metrics');
const { errorHandler } = require('../../../shared/middlewares/errorHandler');

const categoryRoutes = require('./routes/category.route');
const productRoutes = require('./routes/product.route');

const { corsMiddleware } = require('./middlewares/cors.middleware');
const { disconnectProducer } = require('./config/kafka');

const app = express();
const { metricsMiddleware, metricsHandler } = createMetrics('catalog-service');

app.use(corsMiddleware);
app.use(helmet({ crossOriginOpenerPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(metricsMiddleware);

app.use((req, res, next) => {
     console.log(`${req.method} ${req.path}`, { ip: req.ip });
     next();
});

app.get('/health', (req, res) => {
     res.status(200).json({ success: true, message: 'Catalog Service is healthy', timestamp: new Date().toISOString() });
});
app.get('/metrics', metricsHandler);

app.use('/categories', categoryRoutes);
app.use('/products', productRoutes);

app.use(errorHandler);

const startServer = async () => {
     try {
          const server = app.listen(config.PORT, () => {
               console.log(`${config.SERVICE_NAME} is running on port ${config.PORT}`);
          });

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
