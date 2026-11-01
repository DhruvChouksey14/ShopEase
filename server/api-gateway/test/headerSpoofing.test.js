const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.INTERNAL_SERVICE_KEY = 'gateway-secret';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.NODE_ENV = 'test';

jest.mock('axios', () => {
     const axios = jest.fn().mockResolvedValue({ status: 200, data: { forwarded: true }, headers: {} });
     axios.create = jest.fn(() => axios);
     return axios;
});

jest.mock('../src/config/redis', () => ({
     redis: {
          eval: jest.fn().mockResolvedValue(1),
          hgetall: jest.fn().mockResolvedValue({}),
          zcount: jest.fn().mockResolvedValue(0),
     },
}));

jest.mock('../../../shared/middlewares/metrics', () => ({
     createMetrics: jest.fn(() => ({
          metricsMiddleware: (req, res, next) => next(),
          metricsHandler: (req, res) => res.status(200).json({}),
     })),
}));

const axios = require('axios');
const app = require('../src/index');

beforeEach(() => axios.mockClear());

test('strips forged user id from anonymous AI events', async () => {
     await request(app)
          .post('/api/ai/events')
          .set('x-user-id', 'victim')
          .send({ eventType: 'view', productId: 'p1' })
          .expect(200);

     const headers = axios.mock.calls[0][0].headers;
     expect(headers['x-user-id']).toBeUndefined();
});

test('strips forged user role from anonymous AI events', async () => {
     await request(app)
          .post('/api/ai/events')
          .set('x-user-role', 'ADMIN')
          .send({ eventType: 'view', productId: 'p1' })
          .expect(200);

     const headers = axios.mock.calls[0][0].headers;
     expect(headers['x-user-role']).toBeUndefined();
});

test('uses the user id from a valid access-token cookie', async () => {
     const token = jwt.sign({ id: 'user-123', role: 'USER' }, process.env.JWT_ACCESS_SECRET);

     await request(app)
          .get('/api/ai/recommendations/user')
          .set('Cookie', [`accessToken=${token}`])
          .expect(200);

     expect(axios.mock.calls[0][0].headers['x-user-id']).toBe('user-123');
});

test('ignores invalid access-token cookies without rejecting the request', async () => {
     await request(app)
          .get('/api/ai/recommendations/user')
          .set('Cookie', ['accessToken=invalid-token'])
          .expect(200);

     expect(axios.mock.calls[0][0].headers['x-user-id']).toBeUndefined();
});

test('replaces a client internal key with the gateway key', async () => {
     await request(app)
          .post('/api/ai/events')
          .set('x-internal-service-key', 'attacker-key')
          .send({ eventType: 'view' })
          .expect(200);

     expect(axios.mock.calls[0][0].headers['x-internal-service-key']).toBe('gateway-secret');
});

test('overwrites a forged user id on an authenticated route', async () => {
     const token = jwt.sign({ id: 'real-user', role: 'USER' }, process.env.JWT_ACCESS_SECRET);

     await request(app)
          .get('/api/users/user/profile')
          .set('x-user-id', 'victim')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

     expect(axios.mock.calls[0][0].headers['x-user-id']).toBe('real-user');
});

test('forwards webhook signature and raw body', async () => {
     const body = JSON.stringify({ event: 'payment.captured' });

     await request(app)
          .post('/api/payments/webhooks/razorpay')
          .set('Content-Type', 'application/json')
          .set('x-razorpay-signature', 'signature')
          .send(body)
          .expect(200);

     const config = axios.mock.calls[0][0];
     expect(config.headers['x-razorpay-signature']).toBe('signature');
     expect(Buffer.isBuffer(config.data)).toBe(true);
     expect(config.data.toString()).toBe(body);
});

test('forwards the refresh cookie', async () => {
     await request(app)
          .post('/api/users/auth/refresh')
          .set('Cookie', ['refreshToken=refresh-token'])
          .send({})
          .expect(200);

     expect(axios.mock.calls[0][0].headers.cookie).toContain('refreshToken=refresh-token');
});
