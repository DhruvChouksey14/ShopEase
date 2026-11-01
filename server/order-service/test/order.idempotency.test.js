const mockPrisma = {
     order: {
          create: jest.fn(),
          findUnique: jest.fn(),
          update: jest.fn(),
     },
     idempotencyRecord: {
          findUnique: jest.fn(),
          create: jest.fn(),
     },
};
const mockCatalogPost = jest.fn();

jest.mock('../src/config/prisma', () => mockPrisma);
jest.mock('../src/services/cartClient', () => ({
     cartClient: { getCart: jest.fn(), clearCart: jest.fn() },
}));
jest.mock('../src/services/saga.service', () => ({
     executeReserveStock: jest.fn(),
     executeCreatePayment: jest.fn(),
     compensateAll: jest.fn(),
}));
jest.mock('../src/services/paymentClient', () => ({
     paymentClient: { getPaymentStatus: jest.fn() },
}));
jest.mock('../src/services/userClient', () => ({ userClient: { getUserById: jest.fn() } }));
jest.mock('../src/services/orderOutbox.service', () => ({ processOrderConfirmedOutbox: jest.fn() }));
jest.mock('../src/services/paymentRetry.service', () => ({ enqueuePaymentRetry: jest.fn() }));
jest.mock('../src/kafka/producer/order.producer', () => ({ publishOrderFailed: jest.fn() }));
jest.mock('../src/sockets/io', () => ({ emitOrderStatus: jest.fn() }));
jest.mock('../../../shared/rabbitmq/rabbitmq', () => ({ publishToQueue: jest.fn() }));
jest.mock('axios', () => ({
     create: jest.fn(() => ({ post: mockCatalogPost })),
}));

const { cartClient } = require('../src/services/cartClient');
const saga = require('../src/services/saga.service');
const { paymentClient } = require('../src/services/paymentClient');
const { createOrder } = require('../src/services/order.service');

const address = { line1: '1 Main Street', city: 'Pune', postalCode: '411001', country: 'India' };
const product = { id: 'product-1', sku: 'sku-1', name: 'Product', pricePaise: 1000, isActive: true, images: [] };

function makeOrder(userId, key, status = 'PENDING') {
     return {
          id: `${userId}-${key}`,
          userId,
          status,
          totalAmountPaise: 1000,
          idempotencyKey: `order:${userId}:${key}`,
          paymentOrderId: 'payment-1',
          lockExpiresAt: new Date(),
          items: [{ productId: product.id, name: product.name, pricePaise: 1000, quantity: 1, imageUrl: null }],
     };
}

function configureDependencies() {
     mockCatalogPost.mockResolvedValue({ data: [product] });
     cartClient.getCart.mockResolvedValue({ items: [{ productId: product.id, quantity: 1 }] });
     cartClient.clearCart.mockResolvedValue(undefined);
     mockPrisma.order.update.mockResolvedValue(undefined);
     saga.executeReserveStock.mockResolvedValue(undefined);
     saga.executeCreatePayment.mockImplementation(async (order) => {
          order.status = 'PAYMENT_PENDING';
          order.paymentOrderId = 'payment-1';
     });
     saga.compensateAll.mockResolvedValue(undefined);
     paymentClient.getPaymentStatus.mockResolvedValue({
          paymentOrderId: 'payment-1',
          gatewayOrderId: 'gateway-1',
          amount: 10,
          amountPaise: 1000,
          currency: 'INR',
          keyId: 'key-1',
     });
     mockPrisma.idempotencyRecord.create.mockResolvedValue(undefined);
}

beforeEach(() => {
     jest.clearAllMocks();
     configureDependencies();
});

test('stores the successful response under the user-scoped idempotency key', async () => {
     const order = makeOrder('user-1', 'key-1');
     mockPrisma.idempotencyRecord.findUnique.mockResolvedValue(null);
     mockPrisma.order.create.mockResolvedValue(order);
     mockPrisma.order.findUnique.mockResolvedValue(order);

     await createOrder('user-1', address, 'key-1');

     expect(mockPrisma.idempotencyRecord.create).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({ eventKey: 'order:user-1:key-1' }),
     }));
});

test('replays a cached response without creating another order', async () => {
     const response = { orderId: 'order-1', status: 'PAYMENT_PENDING' };
     mockPrisma.idempotencyRecord.findUnique.mockResolvedValue({ response });

     await expect(createOrder('user-1', address, 'key-1')).resolves.toEqual(response);
     expect(mockPrisma.order.create).not.toHaveBeenCalled();
});

test('does not share a key between users', async () => {
     const response = { orderId: 'order-1', status: 'PAYMENT_PENDING' };
     mockPrisma.idempotencyRecord.findUnique.mockImplementation(async ({ where }) => (
          where.eventKey === 'order:user-1:key-1' ? { response } : null
     ));
     const order = makeOrder('user-2', 'key-1');
     mockPrisma.order.create.mockResolvedValue(order);
     mockPrisma.order.findUnique.mockResolvedValue(order);

     const result = await createOrder('user-2', address, 'key-1');

     expect(result.orderId).toBe(order.id);
     expect(mockPrisma.order.create).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({ idempotencyKey: 'order:user-2:key-1' }),
     }));
});

test('returns the existing payment-pending order after a duplicate create', async () => {
     const order = makeOrder('user-1', 'key-1', 'PAYMENT_PENDING');
     mockPrisma.idempotencyRecord.findUnique.mockResolvedValue(null);
     mockPrisma.order.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 'P2002' }));
     mockPrisma.order.findUnique.mockResolvedValue(order);

     await expect(createOrder('user-1', address, 'key-1')).resolves.toEqual(expect.objectContaining({ orderId: order.id }));
});

test.each(['FAILED', 'EXPIRED', 'CANCELLED'])('rejects a duplicate %s order with IDEMPOTENCY_KEY_USED', async (status) => {
     mockPrisma.idempotencyRecord.findUnique.mockResolvedValue(null);
     mockPrisma.order.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 'P2002' }));
     mockPrisma.order.findUnique.mockResolvedValue(makeOrder('user-1', 'key-1', status));

     await expect(createOrder('user-1', address, 'key-1')).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_USED' });
});

test.each(['PENDING', 'STOCK_RESERVED', 'CONFIRMING'])('rejects a duplicate %s order with ORDER_IN_PROGRESS', async (status) => {
     mockPrisma.idempotencyRecord.findUnique.mockResolvedValue(null);
     mockPrisma.order.create.mockRejectedValue(Object.assign(new Error('duplicate'), { code: 'P2002' }));
     mockPrisma.order.findUnique.mockResolvedValue(makeOrder('user-1', 'key-1', status));

     await expect(createOrder('user-1', address, 'key-1')).rejects.toMatchObject({ code: 'ORDER_IN_PROGRESS' });
});

test('concurrent submissions create one order and expose the in-progress conflict', async () => {
     let existingOrder;
     mockPrisma.idempotencyRecord.findUnique.mockResolvedValue(null);
     mockPrisma.order.create.mockImplementation(async ({ data }) => {
          if (existingOrder) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
          existingOrder = makeOrder(data.userId, 'key-1');
          return existingOrder;
     });
     mockPrisma.order.findUnique.mockImplementation(async () => existingOrder);

     const results = await Promise.allSettled([
          createOrder('user-1', address, 'key-1'),
          createOrder('user-1', address, 'key-1'),
     ]);

     expect(mockPrisma.order.create).toHaveBeenCalledTimes(2);
     expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
     expect(results.filter((result) => result.status === 'rejected')[0].reason.code).toBe('ORDER_IN_PROGRESS');
});
