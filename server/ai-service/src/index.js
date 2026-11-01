require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const { config } = require('./config');
const { redis } = require('./config/redis');
const routes = require('./routes');
const consumer = require('./kafka/consumer');
const eventProducer = require('./kafka/producer');
const { createMetrics } = require('../../../shared/middlewares/metrics');
const { errorHandler } = require('../../../shared/middlewares/errorHandler');
const app = express();
const { metricsMiddleware, metricsHandler } = createMetrics('ai-service');
app.use(helmet());
app.use(express.json({ limit: '8kb' }));
app.use(metricsMiddleware);
app.use('/', routes);
app.get('/health', (_req, res) => res.json({ success: true, service: 'ai-service' }));
app.get('/metrics', metricsHandler);
app.use(errorHandler);
if (require.main === module) {
     (async () => {
          await consumer.start();
          const server = app.listen(config.PORT, () => console.log(`ai-service listening on ${config.PORT}`));
          const shutdown = async () => { server.close(); await consumer.stop(); await eventProducer.stop(); await redis.quit(); process.exit(0); };
          process.on('SIGTERM', shutdown);
          process.on('SIGINT', shutdown);
     })().catch((error) => { console.error('AI service startup failed', { message: error.message }); process.exit(1); });
}
module.exports = app;
