const prisma = require('../config/prisma');
const { inventoryClient } = require('./inventoryClient');
const { paymentClient } = require('./paymentClient');

/**
 * Saga orchestrator for the order lifecycle (orchestration-based Saga pattern).
 * Every step is logged to SagaLog before and after execution, so a crashed
 * order-service instance can be diagnosed/replayed from the log instead of
 * leaving the order in an ambiguous state.
 *
 * Forward flow:      RESERVE_STOCK -> CREATE_PAYMENT -> CONFIRM_STOCK -> COMPLETE
 * Compensation flow: reverse of whatever forward steps actually completed
 */

// ─── Forward Steps ───────────────────────────────────────────────────────────

async function executeReserveStock(order, items) {
     const sagaLog = await prisma.sagaLog.create({
          data: { orderId: order.id, step: 'RESERVE_STOCK', status: 'PENDING', request: { items } },
     });

     try {
          const result = await inventoryClient.reserveStock(order.id, items);

          await prisma.sagaLog.update({ where: { id: sagaLog.id }, data: { status: 'COMPLETED', response: result } });
          await prisma.order.update({ where: { id: order.id }, data: { status: 'STOCK_RESERVED' } });

          console.log(`Saga RESERVE_STOCK completed for order ${order.id}`);
          return result;
     } catch (error) {
          const errorMsg = error.response?.data?.message || error.message;
          await prisma.sagaLog.update({ where: { id: sagaLog.id }, data: { status: 'FAILED', error: errorMsg } });
          throw error;
     }
}

async function executeCreatePayment(order) {
     const idempotencyKey = `${order.id}-payment`;
     const sagaLog = await prisma.sagaLog.create({
          data: { orderId: order.id, step: 'CREATE_PAYMENT', status: 'PENDING', request: { orderId: order.id, amount: order.totalAmount } },
     });

     try {
          const result = await paymentClient.createPaymentOrder(order.id, order.totalAmount, order.userId, idempotencyKey);

          await prisma.sagaLog.update({ where: { id: sagaLog.id }, data: { status: 'COMPLETED', response: result } });
          await prisma.order.update({ where: { id: order.id }, data: { status: 'PAYMENT_PENDING', paymentOrderId: result.paymentOrderId } });

          console.log(`Saga CREATE_PAYMENT completed for order ${order.id}`);
          return result;
     } catch (error) {
          const errorMsg = error.response?.data?.message || error.message;
          await prisma.sagaLog.update({ where: { id: sagaLog.id }, data: { status: 'FAILED', error: errorMsg } });
          throw error;
     }
}

async function executeConfirmStock(order, items) {
     const sagaLog = await prisma.sagaLog.create({
          data: { orderId: order.id, step: 'CONFIRM_STOCK', status: 'PENDING', request: { items } },
     });

     try {
          const result = await inventoryClient.confirmStock(order.id, items);
          await prisma.sagaLog.update({ where: { id: sagaLog.id }, data: { status: 'COMPLETED', response: result } });
          console.log(`Saga CONFIRM_STOCK completed for order ${order.id}`);
          return result;
     } catch (error) {
          const errorMsg = error.response?.data?.message || error.message;
          await prisma.sagaLog.update({ where: { id: sagaLog.id }, data: { status: 'FAILED', error: errorMsg } });
          throw error;
     }
}

// ─── Compensation Steps ──────────────────────────────────────────────────────

async function compensateReserveStock(order, items) {
     console.log(`Compensating RESERVE_STOCK for order ${order.id}`);
     try {
          await inventoryClient.releaseStock(order.id, items);
          await prisma.sagaLog.updateMany({
               where: { orderId: order.id, step: 'RESERVE_STOCK', status: 'COMPLETED' },
               data: { status: 'COMPENSATED' },
          });
     } catch (error) {
          console.error(`Failed to compensate RESERVE_STOCK for order ${order.id}`, { error: error.message });
          // The reservation-expiry sweep in inventory-service is the safety net if this fails.
     }
}

async function compensateCreatePayment(order) {
     if (!order.paymentOrderId) return;
     console.log(`Compensating CREATE_PAYMENT for order ${order.id}`);
     try {
          const idempotencyKey = `${order.id}-refund-compensation`;
          await paymentClient.initiateRefund(order.paymentOrderId, order.totalAmount, 'order_compensation', idempotencyKey);
          await prisma.sagaLog.updateMany({
               where: { orderId: order.id, step: 'CREATE_PAYMENT', status: 'COMPLETED' },
               data: { status: 'COMPENSATED' },
          });
     } catch (error) {
          console.error(`Failed to compensate CREATE_PAYMENT for order ${order.id}`, { error: error.message });
     }
}

async function compensateConfirmStock(order, items) {
     console.log(`Compensating CONFIRM_STOCK for order ${order.id}`);
     try {
          // Stock was already permanently decremented — compensating a confirm means
          // giving the stock back (treat exactly like a release).
          await inventoryClient.releaseStock(order.id, items);
          await prisma.sagaLog.updateMany({
               where: { orderId: order.id, step: 'CONFIRM_STOCK', status: 'COMPLETED' },
               data: { status: 'COMPENSATED' },
          });
     } catch (error) {
          console.error(`Failed to compensate CONFIRM_STOCK for order ${order.id}`, { error: error.message });
     }
}

/**
 * Compensate all completed saga steps for an order, in reverse order.
 */
async function compensateAll(order, items) {
     const completedSteps = await prisma.sagaLog.findMany({
          where: { orderId: order.id, status: 'COMPLETED' },
          orderBy: { createdAt: 'desc' },
     });

     for (const step of completedSteps) {
          switch (step.step) {
               case 'CONFIRM_STOCK':
                    await compensateConfirmStock(order, items);
                    break;
               case 'CREATE_PAYMENT':
                    await compensateCreatePayment(order);
                    break;
               case 'RESERVE_STOCK':
                    await compensateReserveStock(order, items);
                    break;
          }
     }
}

module.exports = {
     executeReserveStock,
     executeCreatePayment,
     executeConfirmStock,
     compensateReserveStock,
     compensateCreatePayment,
     compensateConfirmStock,
     compensateAll,
};
