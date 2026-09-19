/**
 * Consumes 'notification.invoice-email' — published by worker-service once it
 * has generated the invoice PDF for a confirmed order. Kept as a separate
 * queue (rather than reusing worker-service's SendGrid client) so all
 * outbound email stays owned by one service.
 *
 * Uses the shared RabbitMQ retry+DLQ topology: a transient SendGrid outage
 * here retries automatically instead of silently dropping the invoice email.
 */
const { setupQueueWithDLQ, withRabbitDLQ, connectRabbitMQ } = require('../../../../shared/rabbitmq/rabbitmq');
const emailService = require('../services/email.service');

const QUEUE_NAME = 'notification.invoice-email';

async function startInvoiceEmailConsumer() {
     const channel = await connectRabbitMQ();
     const topology = await setupQueueWithDLQ(QUEUE_NAME);

     const handler = withRabbitDLQ(channel, topology, async (payload) => {
          const { email, firstName, orderId, totalAmount, pdfBase64 } = payload;
          if (!email || !pdfBase64) {
               console.warn('Invoice email job missing email or pdfBase64 — skipping', { orderId });
               return;
          }
          await emailService.sendInvoiceEmail(email, { firstName, orderId, totalAmount }, pdfBase64);
          console.log(`Invoice email sent to ${email}`, { orderId });
     });

     await channel.consume(QUEUE_NAME, handler, { noAck: false });
     console.log(`Listening for invoice-email jobs on queue "${QUEUE_NAME}"`);
}

module.exports = { startInvoiceEmailConsumer };
