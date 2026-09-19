const { producer, connectProducer } = require('../../config/kafka');
const { KAFKA_TOPICS } = require('../../../../../shared/constants/kafka-topics');

class PaymentProducer {
     constructor() { this.isInitialized = false; }

     async initialize() {
          if (!this.isInitialized) {
               await connectProducer();
               this.isInitialized = true;
          }
     }

     async sendMessage(topic, key, value) {
          try {
               await this.initialize();
               const result = await producer.send({
                    topic,
                    messages: [{
                         key: key || `${topic}-${Date.now()}`,
                         value: JSON.stringify(value),
                         timestamp: Date.now().toString(),
                    }],
               });
               console.log(`Message sent to topic: ${topic}`, {
                    key,
                    partition: result[0].partition,
                    offset: result[0].offset,
               });
               return result;
          } catch (error) {
               console.error(`Failed to send message to topic: ${topic}`, {
                    error: error.message,
                    key,
               });
               throw error;
          }
     }

     async publishPaymentSuccess(paymentOrderId, orderId, gatewayPaymentId, amount) {
          return this.sendMessage(
               KAFKA_TOPICS.PAYMENT_SUCCESS,
               `payment-${paymentOrderId}`,
               {
                    paymentOrderId,
                    orderId,
                    gatewayPaymentId,
                    amount,
                    capturedAt: new Date().toISOString(),
               }
          );
     }

     async publishPaymentFailed(paymentOrderId, orderId, reason) {
          return this.sendMessage(
               KAFKA_TOPICS.PAYMENT_FAILED,
               `payment-${paymentOrderId}`,
               {
                    paymentOrderId,
                    orderId,
                    reason,
                    failedAt: new Date().toISOString(),
               }
          );
     }
}

module.exports = new PaymentProducer();
