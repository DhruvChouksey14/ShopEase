jest.mock('../../order-service/src/config/prisma', () => ({ orderOutbox: {
  updateMany: jest.fn(), findMany: jest.fn(), update: jest.fn(),
} }));
jest.mock('../../order-service/src/services/userClient', () => ({ userClient: { getUserById: jest.fn() } }));
jest.mock('../../order-service/src/kafka/producer/order.producer', () => ({ publishOrderConfirmed: jest.fn() }));

const prisma = require('../../order-service/src/config/prisma');
const { userClient } = require('../../order-service/src/services/userClient');
const producer = require('../../order-service/src/kafka/producer/order.producer');
const { processOrderConfirmedOutbox } = require('../../order-service/src/services/orderOutbox.service');

beforeEach(() => jest.clearAllMocks());

test('confirmed-order outbox publishes then marks the event delivered', async () => {
  const row = { id: 'outbox1', attempts: 0, payload: { orderId: 'o1', userId: 'u1', items: [{ productId: 'p1' }] } };
  prisma.orderOutbox.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
  prisma.orderOutbox.findMany.mockResolvedValue([row]);
  prisma.orderOutbox.update.mockResolvedValue({});
  userClient.getUserById.mockResolvedValue({ email: 'buyer@example.com', firstName: 'Buyer' });

  await processOrderConfirmedOutbox();

  expect(producer.publishOrderConfirmed).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'o1', email: 'buyer@example.com' }));
  expect(prisma.orderOutbox.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'outbox1' }, data: { status: 'DELIVERED', lastError: null } }));
});

test('confirmed-order outbox retains and schedules events when publication fails', async () => {
  const row = { id: 'outbox2', attempts: 0, payload: { orderId: 'o2', userId: 'u2' } };
  prisma.orderOutbox.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
  prisma.orderOutbox.findMany.mockResolvedValue([row]);
  prisma.orderOutbox.update.mockResolvedValue({});
  userClient.getUserById.mockRejectedValue(new Error('user service unavailable'));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});

  await processOrderConfirmedOutbox();

  expect(prisma.orderOutbox.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'outbox2' }, data: expect.objectContaining({ status: 'PENDING', attempts: 1, lastError: 'user service unavailable' }),
  }));
  expect(producer.publishOrderConfirmed).not.toHaveBeenCalled();
  log.mockRestore();
});
