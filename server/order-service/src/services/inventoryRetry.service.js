const prisma = require('../config/prisma');
const { inventoryClient } = require('./inventoryClient');

async function enqueueInventoryRetry({ orderId, operation, items, idempotencyKey }) {
     return prisma.inventoryRetry.upsert({
          where: { idempotencyKey },
          update: {},
          create: { orderId, operation, items, idempotencyKey },
     });
}

async function processInventoryRetries(limit = 25) {
     await prisma.inventoryRetry.updateMany({ where: { status: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - 60000) } }, data: { status: 'PENDING' } });
     const rows = await prisma.inventoryRetry.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: 'asc' }, take: limit });
     for (const row of rows) {
          const claimed = await prisma.inventoryRetry.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: 'PROCESSING' } });
          if (!claimed.count) continue;
          try {
               if (row.operation === 'RESTOCK') await inventoryClient.restockConfirmedStock(row.orderId, row.items);
               else await inventoryClient.releaseStock(row.orderId, row.items);
               await prisma.inventoryRetry.update({ where: { id: row.id }, data: { status: 'COMPLETED', lastError: null } });
          } catch (error) {
               const attempts = row.attempts + 1;
               await prisma.inventoryRetry.update({ where: { id: row.id }, data: { status: 'PENDING', attempts, lastError: error.message, nextAttemptAt: new Date(Date.now() + Math.min(3600000, 1000 * (2 ** Math.min(attempts, 12)))) } });
               console.error('Inventory compensation retry failed; retry persisted', { retryId: row.id, operation: row.operation, attempts, error: error.message });
          }
     }
     return rows.length;
}

module.exports = { enqueueInventoryRetry, processInventoryRetries };
