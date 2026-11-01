const Redis = require('ioredis');
const { config } = require('./index');
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, retryStrategy: (n) => Math.min(n * 100, 2000) });
module.exports = { redis };
