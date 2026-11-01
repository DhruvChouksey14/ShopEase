jest.mock('../../inventory-service/src/config/prisma', () => ({
  $transaction: jest.fn(),
  stockReservation: { findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
  stock: { findUnique: jest.fn(), update: jest.fn() },
  stockLedger: { create: jest.fn() },
}));
jest.mock('../../inventory-service/src/kafka/producer/inventory.producer', () => ({ publishStockUpdated: jest.fn() }));

const prisma = require('../../inventory-service/src/config/prisma');
const { sweepExpiredReservations } = require('../../inventory-service/src/services/inventory.service');

test('expiry sweep cannot release a reservation extended after its initial scan', async () => {
  const futureExpiry = new Date(Date.now() + 60_000);
  prisma.stockReservation.findMany.mockResolvedValue([{ orderId: 'o1', productId: 'p1', quantity: 2, expiresAt: new Date(Date.now() - 1000) }]);
  prisma.stockReservation.findUnique.mockResolvedValue({ id: 'r1', orderId: 'o1', productId: 'p1', quantity: 2, status: 'HELD', expiresAt: futureExpiry });
  prisma.stockReservation.updateMany.mockImplementation(async ({ where }) => ({
    count: where.expiresAt?.lte >= futureExpiry ? 1 : 0,
  }));
  prisma.$transaction.mockImplementation((callback) => callback({
    stockReservation: prisma.stockReservation,
    stock: prisma.stock,
    stockLedger: prisma.stockLedger,
  }));
  prisma.stock.findUnique.mockResolvedValue({ productId: 'p1', available: 4, reserved: 2 });

  await sweepExpiredReservations();

  const conditional = prisma.stockReservation.updateMany.mock.calls[0][0].where;
  expect(conditional).toMatchObject({ id: 'r1', status: 'HELD' });
  expect(conditional.expiresAt.lte).toBeInstanceOf(Date);
  expect(prisma.stock.update).not.toHaveBeenCalled();
});
