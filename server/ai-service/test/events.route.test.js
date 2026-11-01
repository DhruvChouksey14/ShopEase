const http = require('node:http');
const express = require('express');

jest.mock('../src/config/redis', () => ({ redis: {
  get: jest.fn(async () => null), set: jest.fn(async () => 'OK'), eval: jest.fn(async () => 1),
  zrevrange: jest.fn(async () => []), quit: jest.fn(async () => 'OK'),
} }));
jest.mock('../src/kafka/producer', () => ({ publishUserEvents: jest.fn(async () => {}) }));
jest.mock('../src/services/chat.service', () => ({ chat: jest.fn() }));

process.env.INTERNAL_SERVICE_KEY = 'test-key';
const router = require('../src/routes');
const { chat } = require('../src/services/chat.service');

function request(app, body, path = '/events') {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const data = JSON.stringify(body);
      const req = http.request({ port, path, method: 'POST', headers: {
        'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-internal-service-key': 'test-key', 'x-user-id': 'u1',
      } }, (res) => {
        let output = '';
        res.on('data', (chunk) => { output += chunk; });
        res.on('end', () => { server.close(); resolve({ status: res.statusCode, body: JSON.parse(output) }); });
      });
      req.on('error', (error) => { server.close(); reject(error); });
      req.end(data);
    });
  });
}

test('client purchase events are rejected by POST /events', async () => {
  const app = express();
  app.use(express.json());
  app.use(router);
  await expect(request(app, { events: [{ eventType: 'purchase', productId: 'p1' }] })).resolves.toEqual({
    status: 400, body: { success: false, message: 'Invalid events payload' },
  });
});

test('invalid event timestamp is replaced with server time', async () => {
  const { publishUserEvents } = require('../src/kafka/producer');
  const app = express();
  app.use(express.json());
  app.use(router);
  await request(app, { events: [{ eventType: 'product_view', productId: 'p1', ts: 'not-a-date' }] });
  const [{ ts }] = publishUserEvents.mock.calls.at(-1)[0];
  expect(Date.parse(ts)).toBeGreaterThan(Date.now() - 5000);
});

test('chat provider errors are returned as a generic 503', async () => {
  chat.mockRejectedValueOnce(new Error('secret provider status text'));
  const app = express();
  app.use(express.json());
  app.use(router);
  const result = await request(app, { message: 'hello' }, '/chat');
  expect(result.status).toBe(503);
  expect(result.body.message).toBe('The assistant is temporarily unavailable.');
  expect(JSON.stringify(result.body)).not.toContain('secret provider status text');
});