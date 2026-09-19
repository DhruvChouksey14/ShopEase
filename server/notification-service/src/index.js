require('dotenv').config();
const express = require('express');
const { config } = require('./config');
const { createMetrics } = require('../../../shared/middlewares/metrics');
const emailConsumer = require('./kafka/consumer/email.consumer');
const { startInvoiceEmailConsumer } = require('./rabbitmq/invoiceEmail.consumer');

const app = express();
const { metricsMiddleware, metricsHandler } = createMetrics('notification-service');
app.use(metricsMiddleware);
app.get('/health', (req, res) => res.json({ success: true, service: config.SERVICE_NAME, timestamp: new Date().toISOString() }));
app.get('/metrics', metricsHandler);

async function startNotificationService() {
     try {
          console.log('Starting Notification Service...');

          const requiredEnvVars = ['SENDGRID_API_KEY', 'MAIL_SEND', 'KAFKA_BROKER'];
          const missing = requiredEnvVars.filter((varName) => !process.env[varName]);
          if (missing.length > 0) {
               throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
          }

          await emailConsumer.start();
          await startInvoiceEmailConsumer();

          app.listen(config.PORT, () => console.log(`${config.SERVICE_NAME} health/metrics server on port ${config.PORT}`));

          console.log('✅ Notification Service started successfully (Kafka + RabbitMQ consumers running)');
     } catch (error) {
          console.error('Failed to start Notification Service', { error: error.message, stack: error.stack });
          process.exit(1);
     }
}

process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection', { reason }));
process.on('uncaughtException', (error) => { console.error('Uncaught Exception', { error: error.message, stack: error.stack }); process.exit(1); });

startNotificationService();
