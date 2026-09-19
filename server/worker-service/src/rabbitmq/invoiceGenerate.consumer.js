/**
 * Consumes 'orders.invoice' — published by order-service the moment a saga
 * completes (order CONFIRMED). Generates the PDF and hands off delivery to
 * notification-service via a second queue. Kept on RabbitMQ (not Kafka)
 * because this is a discrete one-shot task per order, not a stream of
 * domain events other services need to replay/subscribe to.
 */
const { setupQueueWithDLQ, withRabbitDLQ, connectRabbitMQ, publishToQueue } = require('../../../../shared/rabbitmq/rabbitmq');
const { generateInvoicePdf } = require('../services/invoice.service');
const { userClient } = require('../services/userClient');

const QUEUE_NAME = 'orders.invoice';

async function startInvoiceGenerateConsumer() {
     const channel = await connectRabbitMQ();
     const topology = await setupQueueWithDLQ(QUEUE_NAME);

     const handler = withRabbitDLQ(channel, topology, async (payload) => {
          const { orderId, userId } = payload;
          console.log(`Generating invoice for order ${orderId}`);

          const pdfBase64 = await generateInvoicePdf(payload);

          let user;
          try {
               user = await userClient.getUserById(userId);
          } catch (err) {
               console.error(`Failed to look up user ${userId} for invoice email — will retry`, { error: err.message });
               throw err; // let the DLQ retry topology handle this — email requires the user's address
          }

          if (!user?.email) {
               console.warn(`User ${userId} has no email on file — dropping invoice email for order ${orderId}`);
               return;
          }

          await publishToQueue('notification.invoice-email', {
               email: user.email,
               firstName: user.firstName,
               orderId,
               totalAmount: payload.totalAmount,
               pdfBase64,
          });

          console.log(`Invoice generated and handed off to notification queue for order ${orderId}`);
     });

     await channel.consume(QUEUE_NAME, handler, { noAck: false });
     console.log(`Listening for invoice-generation jobs on queue "${QUEUE_NAME}"`);
}

module.exports = { startInvoiceGenerateConsumer };
