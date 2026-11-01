jest.mock('../src/config/redis', () => ({ redis: { eval: jest.fn(async () => 1) } }));
const { redis } = require('../src/config/redis');
const { applyConfirmedEvent, updateScript } = require('../src/kafka/consumer');

test('confirmed-event consumer applies co-purchases idempotently by event order id', async () => {
  await expect(applyConfirmedEvent({ orderId: 'order-1', items: [{ productId: 'p1' }, { productId: 'p2' }] })).resolves.toBe(true);
  expect(redis.eval).toHaveBeenCalledTimes(1);
  expect(redis.eval.mock.calls[0][2]).toBe('ai:processed:orders');
  expect(redis.eval.mock.calls[0][3]).toBe('order-1');
  expect(updateScript).toContain("redis.call('SADD'");
  expect(updateScript).toContain('== 0 then return 0');
});
