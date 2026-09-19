const { consumer, producer, connectProducer } = require('../../config/kafka');
const inventoryService = require('../../services/inventory.service');
const { KAFKA_TOPICS } = require('../../../../../shared/constants/kafka-topics');
const { withDLQ } = require('../../../../../shared/utils/dlqHandler');

class InventoryConsumer {
     async start() {
          await consumer.connect();
          await connectProducer();
          console.log('Inventory consumer connected to Kafka');

          await consumer.subscribe({
               topics: [KAFKA_TOPICS.PRODUCT_CREATED, KAFKA_TOPICS.PRODUCT_DELETED],
               fromBeginning: true,
          });

          await consumer.run({
               eachMessage: withDLQ(producer, KAFKA_TOPICS.DLQ_INVENTORY, async ({ topic, parsedValue }) => {
                    switch (topic) {
                         case KAFKA_TOPICS.PRODUCT_CREATED:
                              await inventoryService.initializeStock(parsedValue.data);
                              break;
                         case KAFKA_TOPICS.PRODUCT_DELETED:
                              // Keep stock row (historical orders may still reference it);
                              // just stop treating it as sellable at the API layer if needed.
                              console.log(`Product ${parsedValue.data.id} deactivated — leaving stock row intact`);
                              break;
                         default:
                              console.warn(`Unknown topic: ${topic}`);
                    }
               }),
          });

          console.log('Inventory consumer is running...');
     }
}

module.exports = new InventoryConsumer();
