const prisma = require('../config/prisma');
const { paymentClient } = require('./paymentClient');

async function enqueuePaymentRetry({ orderId, paymentOrderId, amountPaise, reason, idempotencyKey }) {
     return prisma.paymentRetry.upsert({
          where: { idempotencyKey },
          update: {},
          create: { orderId, paymentOrderId, amountPaise, reason, idempotencyKey },
     });
}

async function processPaymentRetries(limit = 25) {
     await prisma.paymentRetry.updateMany({ where: { status: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - 60000) } }, data: { status: 'PENDING' } });
     const rows = await prisma.paymentRetry.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: 'asc' }, take: limit });
     for (const row of rows) {
          const claimed = await prisma.paymentRetry.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: 'PROCESSING' } });
          if (!claimed.count) continue;
          try {
               await paymentClient.initiateRefund(row.paymentOrderId, row.amountPaise, row.reason, row.idempotencyKey);
               await prisma.paymentRetry.update({ where: { id: row.id }, data: { status: 'COMPLETED', lastError: null } });
          } catch (error) {
               const attempts = row.attempts + 1;
               await prisma.paymentRetry.update({ where: { id: row.id }, data: { status: 'PENDING', attempts, lastError: error.message, nextAttemptAt: new Date(Date.now() + Math.min(3600000, 1000 * (2 ** Math.min(attempts, 12)))) } });
               console.error('Refund retry failed; retry persisted', { retryId: row.id, attempts, error: error.message });
          }
     }
     return rows.length;
}

module.exports = { enqueuePaymentRetry, processPaymentRetries };
