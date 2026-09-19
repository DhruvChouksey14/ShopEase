const { consumer, producer, connectProducer } = require('../../config/kafka');
const emailService = require('../../services/email.service');
const { KAFKA_TOPICS } = require('../../../../../shared/constants/kafka-topics');
const { withDLQ } = require('../../../../../shared/utils/dlqHandler');

class EmailConsumer {
     async start() {
          try {
               await consumer.connect();
               await connectProducer(); // needed for DLQ publishing
               console.log('Email consumer connected to Kafka');

               await consumer.subscribe({
                    topics: [
                         KAFKA_TOPICS.OTP_EMAIL,
                         KAFKA_TOPICS.WELCOME_EMAIL,
                         KAFKA_TOPICS.ORDER_CONFIRMED,
                         KAFKA_TOPICS.ORDER_FAILED,
                         KAFKA_TOPICS.ORDER_CANCELLED,
                         KAFKA_TOPICS.ORDER_SHIPPED,
                    ],
                    fromBeginning: false,
               });

               await consumer.run({
                    eachMessage: withDLQ(producer, KAFKA_TOPICS.DLQ_NOTIFICATION, async ({ topic, parsedValue }) => {
                         console.log(`Processing message from topic: ${topic}`);
                         await this.handleMessage(topic, parsedValue);
                    }),
               });

               console.log('Email consumer is running and listening for messages...');
          } catch (error) {
               console.error('Failed to start email consumer', { error: error.message });
               throw error;
          }
     }

     async handleMessage(topic, data) {
          switch (topic) {
               case KAFKA_TOPICS.OTP_EMAIL:
                    return this.handleOtpEmail(data);
               case KAFKA_TOPICS.WELCOME_EMAIL:
                    return this.handleWelcomeEmail(data);
               case KAFKA_TOPICS.ORDER_CONFIRMED:
                    return this.handleOrderConfirmed(data);
               case KAFKA_TOPICS.ORDER_FAILED:
                    return this.handleOrderFailed(data);
               case KAFKA_TOPICS.ORDER_CANCELLED:
                    return this.handleOrderCancelled(data);
               case KAFKA_TOPICS.ORDER_SHIPPED:
                    return this.handleOrderShipped(data);
               default:
                    console.warn(`Unknown topic: ${topic}`);
          }
     }

     async handleOtpEmail(data) {
          const { email, otp, ttlMinutes } = data;
          if (!email || !otp) throw new Error('Missing required fields: email or otp');
          await emailService.sendOtpEmail(email, otp, ttlMinutes || 5);
          console.log(`OTP email sent to ${email}`);
     }

     async handleWelcomeEmail(data) {
          const { email, firstName } = data;
          if (!email || !firstName) throw new Error('Missing required fields: email or firstName');
          await emailService.sendWelcomeEmail(email, firstName);
          console.log(`Welcome email sent to ${email}`);
     }

     async handleOrderConfirmed(data) {
          if (!data.email) return console.warn('Skipping order-confirmed email — no email on event', { orderId: data.orderId });
          await emailService.sendOrderConfirmedEmail(data.email, data);
          console.log(`Order confirmed email sent to ${data.email}`, { orderId: data.orderId });
     }

     async handleOrderFailed(data) {
          if (!data.email) return console.warn('Skipping order-failed email — no email on event', { orderId: data.orderId });
          await emailService.sendOrderFailedEmail(data.email, data);
          console.log(`Order failed email sent to ${data.email}`, { orderId: data.orderId });
     }

     async handleOrderCancelled(data) {
          if (!data.email) return console.warn('Skipping order-cancelled email — no email on event', { orderId: data.orderId });
          await emailService.sendOrderCancelledEmail(data.email, data);
          console.log(`Order cancelled email sent to ${data.email}`, { orderId: data.orderId });
     }

     async handleOrderShipped(data) {
          if (!data.email) return console.warn('Skipping order-shipped email — no email on event', { orderId: data.orderId });
          await emailService.sendOrderShippedEmail(data.email, data);
          console.log(`Order shipped email sent to ${data.email}`, { orderId: data.orderId });
     }

     async stop() {
          await consumer.disconnect();
          console.log('Email consumer disconnected');
     }
}

module.exports = new EmailConsumer();
