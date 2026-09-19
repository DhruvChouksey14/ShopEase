const { producer, connectProducer } = require('../../config/kafka');
const { KAFKA_TOPICS } = require('../../../../../shared/constants/kafka-topics');

const RETRY_ATTEMPTS = 3;

async function publishWithRetry(topic, key, value, attempt = 1) {
     try {
          await connectProducer();
          await producer.send({
               topic,
               messages: [{ key, value: JSON.stringify(value) }],
          });
     } catch (error) {
          console.error(`Failed to publish to ${topic} (attempt ${attempt}/${RETRY_ATTEMPTS})`, {
               error: error.message,
          });
          if (attempt < RETRY_ATTEMPTS) {
               const delay = Math.pow(2, attempt) * 500;
               await new Promise((r) => setTimeout(r, delay));
               return publishWithRetry(topic, key, value, attempt + 1);
          }
          throw error;
     }
}

exports.publishProductCreated = (product) =>
     publishWithRetry(KAFKA_TOPICS.PRODUCT_CREATED, product.id, { eventType: 'PRODUCT_CREATED', data: product, timestamp: new Date().toISOString() });

exports.publishProductUpdated = (product) =>
     publishWithRetry(KAFKA_TOPICS.PRODUCT_UPDATED, product.id, { eventType: 'PRODUCT_UPDATED', data: product, timestamp: new Date().toISOString() });

exports.publishProductDeleted = (productId) =>
     publishWithRetry(KAFKA_TOPICS.PRODUCT_DELETED, productId, { eventType: 'PRODUCT_DELETED', data: { id: productId }, timestamp: new Date().toISOString() });

exports.publishCategoryCreated = (category) =>
     publishWithRetry(KAFKA_TOPICS.CATEGORY_CREATED, category.id, { eventType: 'CATEGORY_CREATED', data: category, timestamp: new Date().toISOString() });

exports.publishCategoryUpdated = (category) =>
     publishWithRetry(KAFKA_TOPICS.CATEGORY_UPDATED, category.id, { eventType: 'CATEGORY_UPDATED', data: category, timestamp: new Date().toISOString() });
