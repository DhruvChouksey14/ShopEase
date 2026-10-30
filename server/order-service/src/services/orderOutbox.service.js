const prisma = require('../config/prisma');
const { userClient } = require('./userClient');
const orderProducer = require('../kafka/producer/order.producer');

async function processOrderConfirmedOutbox(limit = 50) {
     await prisma.orderOutbox.updateMany({
          where: { status: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - 60000) } },
          data: { status: 'PENDING' },
     });
     const rows = await prisma.orderOutbox.findMany({
          where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
          orderBy: { createdAt: 'asc' },
          take: limit,
     });

     for (const row of rows) {
          const claimed = await prisma.orderOutbox.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: 'PROCESSING' } });
          if (!claimed.count) continue;
          try {
               const payload = row.payload;
               const user = await userClient.getUserById(payload.userId);
               if (!user?.email) throw new Error('Order event recipient email is not available');
               await orderProducer.publishOrderConfirmed({ ...payload, email: user.email, firstName: user.firstName || '' });
               await prisma.orderOutbox.update({ where: { id: row.id }, data: { status: 'DELIVERED', lastError: null } });
          } catch (error) {
               const attempts = row.attempts + 1;
               const delayMs = Math.min(3600000, 1000 * (2 ** Math.min(attempts, 12)));
               await prisma.orderOutbox.update({
                    where: { id: row.id },
                    data: { status: 'PENDING', attempts, lastError: error.message, nextAttemptAt: new Date(Date.now() + delayMs) },
               });
               console.error('Order confirmation outbox delivery deferred', { outboxId: row.id, orderId: row.payload.orderId, attempts, error: error.message });
          }
     }
     return rows.length;
}

module.exports = { processOrderConfirmedOutbox };
