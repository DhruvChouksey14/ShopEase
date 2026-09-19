require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { config } = require('./config');
const { initIndices, recreateIndices } = require('./config/elasticsearch');
const { createMetrics } = require('../../../shared/middlewares/metrics');
const { errorHandler } = require('../../../shared/middlewares/errorHandler');

const { corsMiddleware } = require('./middlewares/cors.middleware');
const searchRoutes = require('./routes/search.route');
const searchConsumer = require('./kafka/consumer/search.consumer');
const { disconnectAll } = require('./config/kafka');

const app = express();
const { metricsMiddleware, metricsHandler } = createMetrics('search-service');

app.use(corsMiddleware);
app.use(helmet({ crossOriginOpenerPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json());
app.use(cookieParser());
app.use(metricsMiddleware);

app.use('/', searchRoutes);

app.get('/health', (req, res) => res.json({ success: true, service: config.SERVICE_NAME, timestamp: new Date().toISOString() }));
app.get('/metrics', metricsHandler);

app.use(errorHandler);

const startServer = async () => {
     if (process.env.ES_RECREATE_INDICES === 'true') {
          await recreateIndices();
     } else {
          await initIndices();
     }
     await searchConsumer.start();

     const server = app.listen(config.PORT, () => {
          console.log(`${config.SERVICE_NAME} running on http://localhost:${config.PORT}`);
     });

     const shutdown = async () => {
          console.log('Shutting down...');
          server.close(async () => {
               await disconnectAll();
               process.exit(0);
          });
     };
     process.on('SIGTERM', shutdown);
     process.on('SIGINT', shutdown);
};

startServer();
module.exports = app;
