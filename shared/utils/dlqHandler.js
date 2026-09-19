/**
 * Dead-Letter Queue (DLQ) handler for Kafka consumers.
 *
 * Wraps eachMessage processing with retry tracking. After DLQ_MAX_RETRIES
 * consecutive failures the message is forwarded to a per-service DLQ topic
 * and the consumer moves on instead of blocking forever.
 *
 * Usage (in any consumer):
 *   const { withDLQ } = require('../../../../../shared/utils/dlqHandler');
 *   await consumer.run({ eachMessage: withDLQ(producer, dlqTopic, handler) });
 */

const { DLQ_MAX_RETRIES } = require('../constants/kafka-topics');

/**
 * @param {import('kafkajs').Producer} producer  – Kafka producer (for sending to DLQ)
 * @param {string}  dlqTopic   – DLQ topic name (e.g. KAFKA_TOPICS.DLQ_BOOKING)
 * @param {Function} handler   – async ({ topic, partition, message, parsedValue }) => void
 * @returns {Function} eachMessage-compatible handler
 */
function withDLQ(producer, dlqTopic, handler) {
     // In-memory retry tracker: key = `${topic}:${partition}:${offset}` → attempt count
     const retryMap = new Map();

     return async ({ topic, partition, message }) => {
          const msgKey = `${topic}:${partition}:${message.offset}`;
          const attempt = (retryMap.get(msgKey) || 0) + 1;
          retryMap.set(msgKey, attempt);

          let parsedValue;
          try {
               parsedValue = JSON.parse(message.value.toString());
          } catch (parseErr) {
               // Completely unparseable — send to DLQ immediately
               console.error(`Unparseable message on ${topic}, sending to DLQ`, {
                    partition,
                    offset: message.offset,
                    error: parseErr.message,
               });
               await sendToDLQ(producer, dlqTopic, topic, partition, message, parseErr);
               retryMap.delete(msgKey);
               return;
          }

          try {
               await handler({ topic, partition, message, parsedValue });
               // Success — clean up
               retryMap.delete(msgKey);
          } catch (error) {
               console.error(`Error processing ${topic} (attempt ${attempt}/${DLQ_MAX_RETRIES})`, {
                    error: error.message,
                    partition,
                    offset: message.offset,
               });

               if (attempt >= DLQ_MAX_RETRIES) {
                    console.error(`Max retries exceeded for ${topic}, sending to DLQ`, {
                         partition,
                         offset: message.offset,
                    });
                    await sendToDLQ(producer, dlqTopic, topic, partition, message, error);
                    retryMap.delete(msgKey);
               } else {
                    // Re-throw so KafkaJS retries (it will re-deliver the same message)
                    throw error;
               }
          }
     };
}

async function sendToDLQ(producer, dlqTopic, originalTopic, partition, message, error) {
     try {
          await producer.send({
               topic: dlqTopic,
               messages: [{
                    key: message.key,
                    value: message.value,
                    headers: {
                         ...message.headers,
                         'dlq-original-topic': originalTopic,
                         'dlq-original-partition': String(partition),
                         'dlq-original-offset': message.offset,
                         'dlq-error': error.message,
                         'dlq-timestamp': new Date().toISOString(),
                    },
               }],
          });
          console.log(`Message sent to DLQ: ${dlqTopic}`, { originalTopic, partition, offset: message.offset });
     } catch (dlqError) {
          // If even the DLQ publish fails, log and move on — don't block the consumer forever
          console.error(`Failed to send message to DLQ ${dlqTopic}`, {
               error: dlqError.message,
               originalTopic,
               partition,
               offset: message.offset,
          });
     }
}

module.exports = { withDLQ };
