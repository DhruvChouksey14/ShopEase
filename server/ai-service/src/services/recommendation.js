const { config } = require('../config');

let failures = 0;
let openUntil = 0;

async function request(path, { userId, query } = {}) {
     if (Date.now() < openUntil) throw new Error('recommendation service circuit open');
     const url = new URL(path, config.RECOMMENDATION_SERVICE_URL);
     Object.entries(query || {}).forEach(([key, value]) => { if (value !== undefined && value !== '') url.searchParams.set(key, value); });
     const controller = new AbortController();
     const timer = setTimeout(() => controller.abort(), Number(process.env.RECOMMENDATION_TIMEOUT_MS || 120));
     try {
          const response = await fetch(url, { signal: controller.signal, headers: { 'x-internal-service-key': config.INTERNAL_SERVICE_KEY, ...(userId ? { 'x-user-id': userId } : {}) } });
          if (!response.ok) throw new Error(`recommendation service returned ${response.status}`);
          failures = 0;
          return (await response.json())?.data?.products || [];
     } catch (error) {
          failures += 1;
          if (failures >= 3) openUntil = Date.now() + 10000;
          throw error;
     } finally { clearTimeout(timer); }
}

module.exports = { request };