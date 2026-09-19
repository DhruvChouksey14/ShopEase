const { consumer, producer, connectProducer } = require('../../config/kafka');
const searchService = require('../../services/search.service');
const { KAFKA_TOPICS } = require('../../../../../shared/constants/kafka-topics');
const { withDLQ } = require('../../../../../shared/utils/dlqHandler');

class SearchConsumer {
     async start() {
          await consumer.connect();
          await connectProducer();
          console.log('Search consumer connected to Kafka');

          await consumer.subscribe({
               topics: [
                    KAFKA_TOPICS.PRODUCT_CREATED,
                    KAFKA_TOPICS.PRODUCT_UPDATED,
                    KAFKA_TOPICS.PRODUCT_DELETED,
                    KAFKA_TOPICS.STOCK_UPDATED,
               ],
               fromBeginning: true,
          });

          await consumer.run({
               eachMessage: withDLQ(producer, KAFKA_TOPICS.DLQ_SEARCH, async ({ topic, parsedValue }) => {
                    switch (topic) {
                         case KAFKA_TOPICS.PRODUCT_CREATED:
                         case KAFKA_TOPICS.PRODUCT_UPDATED:
                              await searchService.indexProduct(parsedValue.data);
                              break;
                         case KAFKA_TOPICS.PRODUCT_DELETED:
                              await searchService.removeProduct(parsedValue.data.id);
                              break;
                         case KAFKA_TOPICS.STOCK_UPDATED:
                              await searchService.updateStockFields(parsedValue.productId, parsedValue.available);
                              break;
                         default:
                              console.warn(`Unknown topic: ${topic}`);
                    }
               }),
          });

          console.log('Search consumer is running...');
     }
}

module.exports = new SearchConsumer();
