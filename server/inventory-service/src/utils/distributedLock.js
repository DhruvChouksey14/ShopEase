const { redis } = require('../config/redis');
/**
 * Redis distributed locking using Lua scripts for atomicity.
 * Lock key pattern: inventory:lock:product:{productId}
 *
 * All-or-nothing acquisition: either ALL product locks are acquired or NONE,
 * preventing a checkout from partially reserving a multi-item cart.
 * productIds are sorted before locking to prevent deadlocks between two
 * concurrent checkouts that share overlapping products in a different order.
 */

const ACQUIRE_SCRIPT = `
local lockValue = ARGV[1]
local ttl = tonumber(ARGV[2])
local acquired = {}

for i, key in ipairs(KEYS) do
     local result = redis.call('SET', key, lockValue, 'NX', 'EX', ttl)
     if not result then
          for j = 1, #acquired do
               redis.call('DEL', acquired[j])
          end
          return 0
     end
     table.insert(acquired, key)
end

return 1
`;

const RELEASE_SCRIPT = `
local lockValue = ARGV[1]
local released = 0

for i, key in ipairs(KEYS) do
     local currentValue = redis.call('GET', key)
     if currentValue == lockValue then
          redis.call('DEL', key)
          released = released + 1
     end
end

return released
`;

function buildLockKeys(productIds) {
     return [...productIds].sort().map((id) => `inventory:lock:product:${id}`);
}

async function acquireProductLocks(productIds, ownerId, ttlSeconds) {
     const keys = buildLockKeys(productIds);
     const lockValue = `${ownerId}:${Date.now()}`;

     try {
          const result = await redis.eval(ACQUIRE_SCRIPT, keys.length, ...keys, lockValue, ttlSeconds);
          if (result === 1) {
               console.log(`Distributed locks acquired for ${ownerId}`, { productCount: productIds.length });
               return { acquired: true, lockValue };
          }
          console.log('Failed to acquire product locks — already locked by a concurrent checkout', { ownerId });
          return { acquired: false, lockValue: null };
     } catch (error) {
          console.error('Error acquiring distributed locks', { error: error.message, ownerId });
          // Fail closed: reject rather than risk overselling stock.
          return { acquired: false, lockValue: null };
     }
}

async function releaseProductLocks(productIds, lockValue) {
     if (!lockValue) return;
     const keys = buildLockKeys(productIds);
     try {
          const released = await redis.eval(RELEASE_SCRIPT, keys.length, ...keys, lockValue);
          console.log(`Released ${released} distributed lock(s)`);
     } catch (error) {
          console.error('Error releasing distributed locks', { error: error.message });
     }
}

module.exports = { acquireProductLocks, releaseProductLocks, buildLockKeys };
