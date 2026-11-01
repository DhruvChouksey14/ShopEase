jest.mock('../../payment-service/src/config/prisma', () => ({
  $transaction: jest.fn(),
  idempotencyRecord: { findUnique: jest.fn(), create: jest.fn() },
}));
jest.mock('../../payment-service/src/kafka/producer/payment.producer', () => ({}));
jest.mock('../../payment-service/src/services/gateways/gateway.factory', () => ({ getGateway: jest.fn() }));

const prisma = require('../../payment-service/src/config/prisma');
const { getGateway } = require('../../payment-service/src/services/gateways/gateway.factory');
const { initiateRefund } = require('../../payment-service/src/services/payment.service');

test('refund reservations serialize on the payment row and prevent concurrent over-refunds', async () => {
  const payment = { id: 'pay1', orderId: 'order1', amountPaise: 1000, status: 'CAPTURED', gatewayPaymentId: 'gw-pay1', refunds: [], version: 1 };
  const idempotency = new Map();
  let releaseLock = Promise.resolve();
  const refunds = payment.refunds;
  const gateway = { initiateRefund: jest.fn(async (_paymentId, amountPaise, { idempotencyKey }) => ({
    gatewayRefundId: `gw-${idempotencyKey}`, rawResponse: { amount: amountPaise },
  })) };
  getGateway.mockReturnValue(gateway);
  prisma.idempotencyRecord.findUnique.mockImplementation(async ({ where }) => idempotency.has(where.eventKey) ? { response: idempotency.get(where.eventKey) } : null);
  prisma.idempotencyRecord.create.mockImplementation(async ({ data }) => {
    if (idempotency.has(data.eventKey)) throw Object.assign(new Error('duplicate idempotency key'), { code: 'P2002' });
    idempotency.set(data.eventKey, data.response);
  });
  prisma.$transaction.mockImplementation(async (callback) => {
    let unlock;
    const previous = releaseLock;
    releaseLock = new Promise((resolve) => { unlock = resolve; });
    await previous;
    try {
      const tx = {
        $queryRaw: jest.fn(async () => [{ id: payment.id }]),
        paymentOrder: {
          findUnique: jest.fn(async () => ({ ...payment, refunds: [...refunds] })),
          update: jest.fn(async ({ data }) => Object.assign(payment, data)),
        },
        refund: {
          findUnique: jest.fn(async ({ where }) => refunds.find((r) => r.idempotencyKey === where.idempotencyKey) || null),
          create: jest.fn(async ({ data }) => { const row = { id: `refund-${refunds.length + 1}`, ...data }; refunds.push(row); return row; }),
          update: jest.fn(async ({ where, data }) => Object.assign(refunds.find((r) => r.id === where.id), data)),
        },
        paymentAuditLog: { create: jest.fn(async () => ({})) },
      };
      return await callback(tx);
    } finally { unlock(); }
  });

  const results = await Promise.allSettled([
    initiateRefund(payment.id, 1000, 'cancel', 'refund-cancel-a'),
    initiateRefund(payment.id, 1000, 'late-capture', 'refund-cancel-b'),
  ]);

  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(gateway.initiateRefund).toHaveBeenCalledTimes(1);
  expect(refunds.reduce((sum, refund) => sum + refund.amountPaise, 0)).toBe(1000);
});
