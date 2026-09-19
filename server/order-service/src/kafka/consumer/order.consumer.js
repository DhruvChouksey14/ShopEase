const { consumer, producer, connectProducer } = require('../../config/kafka');
const orderService = require('../../services/order.service');
const { KAFKA_TOPICS } = require('../../../../../shared/constants/kafka-topics');
const { withDLQ } = require('../../../../../shared/utils/dlqHandler');

class OrderConsumer {
     async start() {
          await consumer.connect();
          await connectProducer();
          console.log('Order consumer connected to Kafka');

          await consumer.subscribe({
               topics: [KAFKA_TOPICS.PAYMENT_SUCCESS, KAFKA_TOPICS.PAYMENT_FAILED],
               fromBeginning: false,
          });

          await consumer.run({
               eachMessage: withDLQ(producer, KAFKA_TOPICS.DLQ_ORDER, async ({ topic, parsedValue }) => {
                    switch (topic) {
                         case KAFKA_TOPICS.PAYMENT_SUCCESS:
                              await orderService.handlePaymentSuccess(
                                   parsedValue.paymentOrderId,
                                   parsedValue.gatewayPaymentId,
                                   parsedValue.amount
                              );
                              break;
                         case KAFKA_TOPICS.PAYMENT_FAILED:
                              await orderService.handlePaymentFailure(parsedValue.paymentOrderId, parsedValue.reason);
                              break;
                         default:
                              console.warn(`Unknown topic: ${topic}`);
                    }
               }),
          });

          console.log('Order consumer is running...');
     }
}

module.exports = new OrderConsumer();
