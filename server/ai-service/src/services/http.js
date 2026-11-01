const { config } = require('../config');
const allowed = {
     search: config.SEARCH_SERVICE_URL,
     catalog: config.CATALOG_SERVICE_URL,
     inventory: config.INVENTORY_SERVICE_URL,
     cart: config.CART_SERVICE_URL,
};
async function request(service, path, { method = 'GET', body, userId } = {}) {
     const base = allowed[service];
     if (!base || !path.startsWith('/')) throw new Error('Unknown service route');
     const controller = new AbortController();
     const timer = setTimeout(() => controller.abort(), 5000);
     try {
          const response = await fetch(new URL(path, base), {
               method, signal: controller.signal,
               headers: {
                    'content-type': 'application/json',
                    'x-internal-service-key': config.INTERNAL_SERVICE_KEY || '',
                    ...(userId ? { 'x-user-id': userId } : {}),
               },
               ...(body ? { body: JSON.stringify(body) } : {}),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) {
               const error = new Error(result.message || `Catalog request failed (${response.status})`);
               error.status = response.status;
               throw error;
          }
          return result.data;
     } finally { clearTimeout(timer); }
}
module.exports = { request };
