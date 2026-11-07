const config = {
     PORT: Number(process.env.PORT || 4009),
     INTERNAL_SERVICE_KEY: process.env.INTERNAL_SERVICE_KEY,
     REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
     KAFKA_BROKER: process.env.KAFKA_BROKER || 'localhost:9093',
     SEARCH_SERVICE_URL: process.env.SEARCH_SERVICE_URL || 'http://localhost:4002',
     CATALOG_SERVICE_URL: process.env.CATALOG_SERVICE_URL || 'http://localhost:4003',
     INVENTORY_SERVICE_URL: process.env.INVENTORY_SERVICE_URL || 'http://localhost:4007',
     CART_SERVICE_URL: process.env.CART_SERVICE_URL || 'http://localhost:4008',
     RECOMMENDATION_SERVICE_URL: process.env.RECOMMENDATION_SERVICE_URL || 'http://localhost:4010',
     LLM_BASE_URL: 'https://api.groq.com/openai/v1',
     LLM_API_KEY: process.env.GROQ_API_KEY || '',
     LLM_MODEL: process.env.LLM_MODEL || 'openai/gpt-oss-20b',
     LLM_TIMEOUT_MS: Number(process.env.LLM_TIMEOUT_MS || 20000),
     RECOMMENDATION_TIMEOUT_MS: Number(process.env.RECOMMENDATION_TIMEOUT_MS || 2000),
     INTERNAL_AUTH_ENABLED: process.env.INTERNAL_AUTH_ENABLED !== 'false',
};
module.exports = { config };
