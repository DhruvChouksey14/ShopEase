const { Kafka, logLevel } = require('kafkajs');
const { KAFKA_TOPICS } = require('../../../../shared/constants/kafka-topics');
const { config } = require('../config');

const kafka = new Kafka({ clientId: 'ai-service-events', brokers: [config.KAFKA_BROKER], logLevel: logLevel.ERROR });
const producer = kafka.producer({ idempotent: true, allowAutoTopicCreation: true });
const crypto = require('crypto');
let connected = false;

async function publishUserEvents(events) {
     if (!connected) { await producer.connect(); connected = true; }
     await producer.send({ topic: KAFKA_TOPICS.USER_EVENTS, messages: events.map((event) => ({ key: event.userId || event.sessionId || 'anonymous', value: JSON.stringify({ eventId: event.eventId || crypto.randomUUID(), ...event }) })) });
}

async function stop() { if (connected) await producer.disconnect().catch(() => {}); connected = false; }
module.exports = { publishUserEvents, stop };