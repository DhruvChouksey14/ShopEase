/**
 * Kafka retry and dead-letter handling. Retry attempt and source-topic values
 * travel in Kafka headers, so consumer restarts do not reset the retry count.
 */
const { DLQ_MAX_RETRIES } = require('../constants/kafka-topics');
const DLQ_PUBLISH_ATTEMPTS = 5;

const headerString = (headers, name) => {
     const value = headers?.[name];
     if (value == null) return null;
     return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
};

function withDLQ(producer, dlqTopic, handler) {
     return async ({ topic, partition, message }) => {
          const sourceTopic = headerString(message.headers, 'retry-original-topic') || topic;
          const attempt = Number(headerString(message.headers, 'retry-attempt') || 1);
          let parsedValue;

          try {
               parsedValue = JSON.parse(message.value.toString());
          } catch (error) {
               await sendToDLQ(producer, dlqTopic, sourceTopic, partition, message, error, attempt);
               return;
          }

          const notBefore = Number(headerString(message.headers, 'retry-not-before') || 0);
          if (notBefore > Date.now()) await new Promise((resolve) => setTimeout(resolve, notBefore - Date.now()));

          try {
               await handler({ topic: sourceTopic, partition, message, parsedValue });
          } catch (error) {
               console.error(`Error processing ${sourceTopic} (attempt ${attempt}/${DLQ_MAX_RETRIES})`, {
                    error: error.message,
                    partition,
                    offset: message.offset,
               });

               if (attempt >= DLQ_MAX_RETRIES) {
                    await sendToDLQ(producer, dlqTopic, sourceTopic, partition, message, error, attempt);
                    return;
               }

               const nextAttempt = attempt + 1;
               const delayMs = Math.min(60000, 1000 * (2 ** (nextAttempt - 2)));
               await producer.send({
                    topic: `${sourceTopic}.retry`,
                    messages: [{
                         key: message.key,
                         value: message.value,
                         headers: {
                              ...message.headers,
                              'retry-original-topic': sourceTopic,
                              'retry-attempt': String(nextAttempt),
                              'retry-not-before': String(Date.now() + delayMs),
                              'retry-last-error': error.message.slice(0, 500),
                         },
                    }],
               });
          }
     };
}

async function sendToDLQ(producer, dlqTopic, originalTopic, partition, message, error, attempt) {
     let lastError;
     for (let publishAttempt = 1; publishAttempt <= DLQ_PUBLISH_ATTEMPTS; publishAttempt += 1) {
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
                              'dlq-attempt': String(attempt),
                              'dlq-error': error.message.slice(0, 500),
                              'dlq-timestamp': new Date().toISOString(),
                         },
                    }],
               });
               console.log(`Message sent to DLQ: ${dlqTopic}`, { originalTopic, partition, offset: message.offset, attempt });
               return;
          } catch (publishError) {
               lastError = publishError;
               if (publishAttempt < DLQ_PUBLISH_ATTEMPTS) {
                    await new Promise((resolve) => setTimeout(resolve, Math.min(30000, 500 * (2 ** (publishAttempt - 1)))));
               }
          }
     }

     // Throwing leaves the source offset unresolved. Kafka retains the original
     // record and the consumer must redeliver it after restart/rebalance; never
     // acknowledge a poison message that could not be durably copied to the DLQ.
     console.error('ALERT: DLQ publish failed; source Kafka record left unacknowledged', {
          dlqTopic, originalTopic, partition, offset: message.offset, attempt,
          publishAttempts: DLQ_PUBLISH_ATTEMPTS, error: lastError?.message,
     });
     throw lastError;
}

module.exports = { withDLQ };
