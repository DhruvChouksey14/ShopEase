require('dotenv').config();
const express = require('express');
const { config } = require('./config');
const { createMetrics } = require('../../../shared/middlewares/metrics');
const { startInvoiceGenerateConsumer } = require('./rabbitmq/invoiceGenerate.consumer');

const app = express();
const { metricsMiddleware, metricsHandler } = createMetrics('worker-service');
app.use(metricsMiddleware);
app.get('/health', (req, res) => res.json({ success: true, service: config.SERVICE_NAME, timestamp: new Date().toISOString() }));
app.get('/metrics', metricsHandler);

async function start() {
     try {
          console.log('Starting Worker Service (background jobs via RabbitMQ)...');
          await startInvoiceGenerateConsumer();
          app.listen(config.PORT, () => console.log(`${config.SERVICE_NAME} health/metrics server on port ${config.PORT}`));
          console.log('✅ Worker Service started successfully');
     } catch (error) {
          console.error('Failed to start Worker Service', { error: error.message, stack: error.stack });
          process.exit(1);
     }
}

process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection', { reason }));
process.on('uncaughtException', (error) => { console.error('Uncaught Exception', { error: error.message }); process.exit(1); });

start();
