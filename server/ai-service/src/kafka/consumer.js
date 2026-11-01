const { Kafka, logLevel } = require('kafkajs');
const { KAFKA_TOPICS } = require('../../../../shared/constants/kafka-topics');
const { withDLQ } = require('../../../../shared/utils/dlqHandler');
const { redis } = require('../config/redis');
const { config } = require('../config');

const kafka = new Kafka({ clientId: 'ai-service', brokers: [config.KAFKA_BROKER], logLevel: logLevel.ERROR });
const consumer = kafka.consumer({ groupId: 'ai-service-recommendations-v1' });
const producer = kafka.producer({ idempotent: true, allowAutoTopicCreation: true });
const updateScript = `
if redis.call('SADD', KEYS[1], ARGV[1]) == 0 then return 0 end
local ids = cjson.decode(ARGV[2])
for i=1,#ids do
 redis.call('ZINCRBY', 'ai:popular', 1, ids[i])
 for j=1,#ids do
  if ids[i] ~= ids[j] then redis.call('ZINCRBY', 'ai:cooc:' .. ids[i], 1, ids[j]) end
 end
end
redis.call('EXPIRE', KEYS[1], 7776000)
return 1`;
async function applyConfirmedEvent(event) {
     const orderId = typeof event.orderId === 'string' ? event.orderId : '';
     const ids = [...new Set((Array.isArray(event.items) ? event.items : []).map((item) => item?.productId).filter((id) => typeof id === 'string' && id.length <= 100))].slice(0, 50);
     if (!orderId || !ids.length) return false;
     await redis.eval(updateScript, 1, `ai:processed:orders`, orderId, JSON.stringify(ids));
     return true;
}
async function start() {
     await producer.connect();
     await consumer.connect();
     await consumer.subscribe({ topic: KAFKA_TOPICS.ORDER_CONFIRMED, fromBeginning: false });
     await consumer.run({ eachMessage: withDLQ(producer, KAFKA_TOPICS.DLQ_AI, async ({ parsedValue }) => applyConfirmedEvent(parsedValue)) });
}
async function stop() { await consumer.disconnect().catch(() => {}); await producer.disconnect().catch(() => {}); }
module.exports = { start, stop, applyConfirmedEvent, updateScript };
