/**
 * Shared RabbitMQ helper — connection + topology setup with a real
 * dead-letter exchange (DLX) retry pattern.
 *
 * Pattern per queue "X":
 *   X                (main queue, consumers bind here)
 *     -> on nack/reject with requeue=false -> routes to X.retry
 *   X.retry          (holds messages for RETRY_DELAY_MS via message TTL,
 *                      then dead-letters back to X for re-processing)
 *   X.dead            (parking lot — messages that exceeded MAX_ATTEMPTS land
 *                      here permanently for manual inspection/replay)
 *
 * Attempt count is tracked via the `x-death` header that RabbitMQ stamps
 * automatically on every dead-lettered message.
 */
const amqp = require('amqplib');

const RETRY_DELAY_MS = parseInt(process.env.RABBITMQ_RETRY_DELAY_MS || '10000', 10);
const MAX_ATTEMPTS = parseInt(process.env.RABBITMQ_MAX_ATTEMPTS || '5', 10);

let connection = null;
let channel = null;

async function connectRabbitMQ(url) {
     if (channel) return channel;

     connection = await amqp.connect(url || process.env.RABBITMQ_URL || 'amqp://localhost:5672');
     channel = await connection.createChannel();
     await channel.prefetch(10);

     connection.on('close', () => {
          console.error('RabbitMQ connection closed — process will exit so the orchestrator can restart it');
          channel = null;
          connection = null;
     });
     connection.on('error', (err) => {
          console.error('RabbitMQ connection error', { error: err.message });
     });

     console.log('Connected to RabbitMQ');
     return channel;
}

/**
 * Declare a queue with a full retry + dead-letter topology.
 * Call once per queue name at service start-up.
 */
async function setupQueueWithDLQ(queueName) {
     const ch = await connectRabbitMQ();
     const deadQueue = `${queueName}.dead`;
     const retryQueue = `${queueName}.retry`;

     // Parking lot — never auto-expires, inspected/replayed manually.
     await ch.assertQueue(deadQueue, { durable: true });

     // Retry queue: messages sit here for RETRY_DELAY_MS then dead-letter
     // back to the main queue for another attempt.
     await ch.assertQueue(retryQueue, {
          durable: true,
          arguments: {
               'x-message-ttl': RETRY_DELAY_MS,
               'x-dead-letter-exchange': '',
               'x-dead-letter-routing-key': queueName,
          },
     });

     // Main queue
     await ch.assertQueue(queueName, { durable: true });

     return { channel: ch, queueName, retryQueue, deadQueue };
}

function getAttemptCount(msg) {
     const xDeath = msg.properties.headers && msg.properties.headers['x-death'];
     if (!xDeath || !Array.isArray(xDeath)) return 0;
     // Count only redeliveries that passed through OUR retry queue
     const retryHop = xDeath.find((d) => d.queue && d.queue.endsWith('.retry'));
     return retryHop ? Number(retryHop.count) : 0;
}

/**
 * Wrap a message handler with retry + DLQ semantics.
 * On failure: route to retry queue until MAX_ATTEMPTS, then to the dead queue.
 */
function withRabbitDLQ(channel, { queueName, retryQueue, deadQueue }, handler) {
     return async (msg) => {
          if (!msg) return;
          const attempt = getAttemptCount(msg) + 1;

          try {
               const payload = JSON.parse(msg.content.toString());
               await handler(payload, msg);
               channel.ack(msg);
          } catch (error) {
               console.error(`RabbitMQ handler failed for ${queueName} (attempt ${attempt}/${MAX_ATTEMPTS})`, {
                    error: error.message,
               });

               if (attempt >= MAX_ATTEMPTS) {
                    channel.sendToQueue(deadQueue, msg.content, {
                         persistent: true,
                         headers: {
                              ...(msg.properties.headers || {}),
                              'x-original-queue': queueName,
                              'x-final-error': error.message,
                         },
                    });
                    console.error(`Moved message to dead-letter queue ${deadQueue} after ${attempt} attempts`);
               } else {
                    channel.sendToQueue(retryQueue, msg.content, {
                         persistent: true,
                         headers: msg.properties.headers || {},
                    });
               }
               channel.ack(msg); // remove from main queue either way — it now lives in retry/dead
          }
     };
}

async function publishToQueue(queueName, payload) {
     const ch = await connectRabbitMQ();
     await ch.assertQueue(queueName, { durable: true });
     return ch.sendToQueue(queueName, Buffer.from(JSON.stringify(payload)), { persistent: true });
}

module.exports = {
     connectRabbitMQ,
     setupQueueWithDLQ,
     withRabbitDLQ,
     publishToQueue,
     getAttemptCount,
};
