const { producer, connectProducer } = require('../../config/kafka');
const { KAFKA_TOPICS } = require('../../../../../shared/constants/kafka-topics');

const RETRY_ATTEMPTS = 3;

async function publishWithRetry(topic, key, value, attempt = 1) {
     try {
          await connectProducer();
          await producer.send({ topic, messages: [{ key, value: JSON.stringify(value) }] });
     } catch (error) {
          console.error(`Failed to publish to ${topic} (attempt ${attempt}/${RETRY_ATTEMPTS})`, { error: error.message });
          if (attempt < RETRY_ATTEMPTS) {
               await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
               return publishWithRetry(topic, key, value, attempt + 1);
          }
          throw error;
     }
}

exports.publishOrderConfirmed = (payload) => publishWithRetry(KAFKA_TOPICS.ORDER_CONFIRMED, payload.orderId, payload);
exports.publishOrderFailed = (payload) => publishWithRetry(KAFKA_TOPICS.ORDER_FAILED, payload.orderId, payload);
exports.publishOrderCancelled = (payload) => publishWithRetry(KAFKA_TOPICS.ORDER_CANCELLED, payload.orderId, payload);
exports.publishOrderShipped = (payload) => publishWithRetry(KAFKA_TOPICS.ORDER_SHIPPED, payload.orderId, payload);
