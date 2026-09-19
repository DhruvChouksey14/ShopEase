const axios = require('axios');
const { config } = require('../config');

const client = axios.create({
     baseURL: config.INVENTORY_SERVICE_URL,
     timeout: 10000,
     headers: { 'Content-Type': 'application/json', 'x-internal-service-key': config.INTERNAL_SERVICE_KEY },
});

/** Retry wrapper with exponential backoff — only retries server/network errors, never 4xx. */
async function withRetry(fn, maxRetries = 3) {
     let lastError;
     for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
               return await fn();
          } catch (error) {
               lastError = error;
               const status = error.response?.status;
               if (status && status >= 400 && status < 500) throw error;
               if (attempt < maxRetries) {
                    const delay = 200 * Math.pow(2, attempt - 1);
                    console.warn(`Inventory client retry ${attempt}/${maxRetries} after ${delay}ms`, { error: error.message });
                    await new Promise((resolve) => setTimeout(resolve, delay));
               }
          }
     }
     throw lastError;
}

function extractError(error) {
     if (error.response?.data) {
          return { status: error.response.status, message: error.response.data.message || error.message, code: error.response.data.code };
     }
     return { status: 500, message: error.message, code: 'INVENTORY_SERVICE_ERROR' };
}

const inventoryClient = {
     async getBulkStock(productIds) {
          return withRetry(async () => {
               const { data } = await client.post('/products/bulk', { productIds });
               return data.data;
          });
     },

     async reserveStock(orderId, items) {
          return withRetry(async () => {
               const { data } = await client.post('/reserve', { orderId, items });
               return data.data;
          });
     },

     async confirmStock(orderId, items) {
          return withRetry(async () => {
               const { data } = await client.post('/confirm', { orderId, items });
               return data.data;
          });
     },

     async releaseStock(orderId, items) {
          return withRetry(async () => {
               const { data } = await client.post('/release', { orderId, items });
               return data.data;
          });
     },
};

module.exports = { inventoryClient, extractError };
