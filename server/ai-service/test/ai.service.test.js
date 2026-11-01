const fs = require('node:fs');
const path = require('node:path');

jest.mock('../src/config/redis', () => ({ redis: {
  get: jest.fn(async () => null), set: jest.fn(async () => 'OK'),
  zrevrange: jest.fn(async () => []), eval: jest.fn(async () => 1),
} }));
jest.mock('../src/services/http', () => ({ request: jest.fn() }));

const { chat } = require('../src/services/chat.service');
const { validateSearchArgs, validateAddArgs, addProductToCart, popularProducts } = require('../src/services/tools');
const { redis } = require('../src/config/redis');
const http = require('../src/services/http');

beforeEach(() => { jest.clearAllMocks(); });

test('unknown model tools are filtered and trusted user id is never sent to the model', async () => {
  const seen = [];
  const llm = jest.fn(async (messages, options) => {
    seen.push(JSON.stringify(messages));
    if (options?.tools === false) return { content: 'Done.' };
    return { tool_calls: [{ id: 'bad', function: { name: 'delete_everything', arguments: '{}' } }] };
  });
  const result = await chat('private-user-123', 'show me shoes', llm);
  expect(result.reply).toBe('Done.');
  expect(seen.join(' ')).not.toContain('private-user-123');
  expect(seen.join(' ')).toContain('Unknown tool');
});

test('tool argument validators strip extra fields and enforce bounds', () => {
  expect(validateSearchArgs({ query: 'boots', userId: 'attacker', limit: 999 })).toEqual({ query: 'boots' });
  expect(validateAddArgs({ productId: 'p1', quantity: 2, userId: 'attacker' })).toEqual({ productId: 'p1', quantity: 2 });
  expect(() => validateAddArgs({ productId: 'p1', quantity: 11 })).toThrow();
  expect(() => validateSearchArgs({ query: 'x'.repeat(161) })).toThrow();
});

test('add-to-cart rejects inactive products and products without enough stock', async () => {
  http.request.mockResolvedValueOnce({ isActive: false });
  await expect(addProductToCart({ productId: 'p1' }, 'user-1', new Set(['p1']))).rejects.toThrow('no longer available');
  http.request.mockResolvedValueOnce({ isActive: true }).mockResolvedValueOnce({ available: 0, inStock: false });
  await expect(addProductToCart({ productId: 'p1' }, 'user-1', new Set(['p1']))).rejects.toThrow('not currently in stock');
  expect(http.request).not.toHaveBeenCalledWith('cart', '/items', expect.anything());
});

test('chat rejects messages over the 1000 character limit before contacting the model', async () => {
  const llm = jest.fn();
  await expect(chat('u1', 'x'.repeat(1001), llm)).rejects.toThrow('1 to 1000');
  expect(llm).not.toHaveBeenCalled();
});

test('popular recommendations use search fallback when event rankings are empty', async () => {
  http.request.mockResolvedValueOnce({ products: [{ productId: 'p2', name: 'Widget', price: 10, inStock: true }] })
    .mockResolvedValueOnce({ available: 4, inStock: true });
  await expect(popularProducts()).resolves.toEqual([expect.objectContaining({ productId: 'p2', name: 'Widget', price: 10 })]);
  expect(redis.zrevrange).toHaveBeenCalledWith('ai:popular', 0, 9);
});

test('service sources do not depend on disallowed commerce providers/services', () => {
  const root = path.join(__dirname, '../src');
  const files = [];
  function walk(dir) { for (const item of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, item.name); if (item.isDirectory()) walk(full); else files.push(full); } }
  walk(root);
  const contents = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n').toLowerCase();
  expect(contents).not.toMatch(/payment-service|order-service|razorpay/);
});

test('frontend checks cart contents before it navigates to checkout', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../../frontend/src/components/ai/ShoppingAssistant.jsx'), 'utf8');
  const checkout = source.slice(source.indexOf('async function checkout()'), source.indexOf('return <div'));
  expect(checkout.indexOf('await cartApi.getCart()')).toBeGreaterThanOrEqual(0);
  expect(checkout.indexOf('if (!data.items?.length)')).toBeGreaterThan(checkout.indexOf('await cartApi.getCart()'));
  expect(checkout.indexOf("navigate('/checkout')")).toBeGreaterThan(checkout.indexOf('if (!data.items?.length)'));
});
