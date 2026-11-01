const axios = require('axios');
const crypto = require('crypto');
const { config } = require('../config');
const { ServiceUnavailableError, GatewayTimeoutError } = require('../utils/error');
const { redis } = require('../config/redis');

const FORWARDED_HEADERS = [
     'content-type',
     'accept',
     'cookie',
     'authorization',
     'x-request-id',
     'x-user-id',
     'x-user-role',
     'x-razorpay-signature',
     'user-agent',
];

const ACQUIRE_BREAKER_SCRIPT = `
local state = redis.call('HGET', KEYS[1], 'state') or 'CLOSED'
if state == 'OPEN' then
  local nextAttempt = tonumber(redis.call('HGET', KEYS[1], 'nextAttempt') or '0')
  if tonumber(ARGV[1]) < nextAttempt then return 0 end
  state = 'HALF_OPEN'
  redis.call('HSET', KEYS[1], 'state', state)
end
if state == 'HALF_OPEN' then
  local probe = redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[3], 'NX')
  if not probe then return 0 end
end
return 1`;

const RECORD_BREAKER_SCRIPT = `
local state = redis.call('HGET', KEYS[1], 'state') or 'CLOSED'
if state == 'HALF_OPEN' then
  redis.call('DEL', KEYS[4])
  if ARGV[2] == '1' then
    redis.call('HSET', KEYS[1], 'state', 'CLOSED')
    redis.call('HDEL', KEYS[1], 'nextAttempt')
    redis.call('DEL', KEYS[2], KEYS[3])
  else
    redis.call('HSET', KEYS[1], 'state', 'OPEN', 'nextAttempt', tonumber(ARGV[1]) + tonumber(ARGV[3]))
  end
  return 1
end
local sampleKey = ARGV[2] == '1' and KEYS[2] or KEYS[3]
redis.call('ZADD', sampleKey, ARGV[1], ARGV[4])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', tonumber(ARGV[1]) - tonumber(ARGV[5]))
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', tonumber(ARGV[1]) - tonumber(ARGV[5]))
local successes = redis.call('ZCARD', KEYS[2])
local failures = redis.call('ZCARD', KEYS[3])
redis.call('EXPIRE', KEYS[2], math.ceil(tonumber(ARGV[5]) / 1000) * 3)
redis.call('EXPIRE', KEYS[3], math.ceil(tonumber(ARGV[5]) / 1000) * 3)
if successes + failures >= tonumber(ARGV[6]) and failures / (successes + failures) >= tonumber(ARGV[7]) then
  redis.call('HSET', KEYS[1], 'state', 'OPEN', 'nextAttempt', tonumber(ARGV[1]) + tonumber(ARGV[3]))
end
return 1`;
/**
 * Circuit Breaker implementation
 * Prevents cascading failures when downstream services are down
 */
class CircuitBreaker {
     constructor(serviceName, threshold = config.CIRCUIT_BREAKER_THRESHOLD, timeout = config.CIRCUIT_BREAKER_TIMEOUT) {
          this.serviceName = serviceName;
          this.failureCount = 0;
          this.threshold = threshold;
          this.timeout = timeout;
          this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
          this.nextAttempt = Date.now();
          this.probeInFlight = false;
          this.windowMs = Number(config.CIRCUIT_BREAKER_WINDOW_MS) || 10000;
          this.minimumRequests = Number(config.CIRCUIT_BREAKER_MIN_REQUESTS) || 10;
          this.failureRateThreshold = Number(config.CIRCUIT_BREAKER_FAILURE_RATE) || 0.5;
          this.samples = [];
          this.redisKeys = [
               `gateway:circuit:${serviceName}:meta`,
               `gateway:circuit:${serviceName}:success`,
               `gateway:circuit:${serviceName}:failure`,
               `gateway:circuit:${serviceName}:probe`,
          ];
     }

     async execute(request) {
          if (!(await this.acquirePermit())) throw new ServiceUnavailableError(`Service ${this.serviceName} is blocked by its circuit breaker.`);

          try {
               const response = await request();
               await this.recordResult(response.status < 500);
               return response;
          } catch (err) {
               await this.recordResult(false);
               throw err;
          }
     }

     async acquirePermit() {
          const now = Date.now();
          try {
               const allowed = await redis.eval(ACQUIRE_BREAKER_SCRIPT, 2, this.redisKeys[0], this.redisKeys[3], now, this.timeout, config.SERVICE_TIMEOUT_MS + 10000);
               return Number(allowed) === 1;
          } catch (error) {
               console.error('ALERT: Redis circuit state unavailable; using process-local fallback', { service: this.serviceName, error: error.message });
               return this.acquireLocalPermit(now);
          }
     }

     async recordResult(succeeded) {
          const now = Date.now();
          try {
               await redis.eval(RECORD_BREAKER_SCRIPT, 4, ...this.redisKeys, now, succeeded ? 1 : 0, this.timeout, `${now}:${crypto.randomUUID()}`, this.windowMs, this.minimumRequests, this.failureRateThreshold);
          } catch (error) {
               console.error('ALERT: Redis circuit result could not be recorded; using process-local fallback', { service: this.serviceName, error: error.message });
               this.recordLocalResult(succeeded, now);
          }
     }

     acquireLocalPermit(now) {
          if (this.state === 'OPEN') {
               if (now < this.nextAttempt) return false;
               this.state = 'HALF_OPEN';
          }
          if (this.state === 'HALF_OPEN') {
               if (this.probeInFlight) return false;
               this.probeInFlight = true;
          }
          return true;
     }

     recordLocalResult(succeeded, now) {
          this.probeInFlight = false;
          if (this.state === 'HALF_OPEN') {
               if (succeeded) {
                    this.state = 'CLOSED';
                    this.samples = [];
               } else this.openCircuit();
               return;
          }
          this.samples = this.samples.filter((sample) => sample.at > now - this.windowMs);
          this.samples.push({ at: now, failed: !succeeded });
          const failures = this.samples.filter((sample) => sample.failed).length;
          this.failureCount = failures;
          if (this.samples.length >= this.minimumRequests && failures / this.samples.length >= this.failureRateThreshold) this.openCircuit();
     }

     openCircuit() {
          this.state = 'OPEN';
          this.nextAttempt = Date.now() + this.timeout;
          console.error(`Circuit breaker OPEN for ${this.serviceName}. Next attempt at ${new Date(this.nextAttempt).toISOString()}`);
     }

     async getState() {
          try {
               const windowStart = Date.now() - this.windowMs;
               const [meta, successes, failures] = await Promise.all([
                    redis.hgetall(this.redisKeys[0]),
                    redis.zcount(this.redisKeys[1], windowStart, '+inf'),
                    redis.zcount(this.redisKeys[2], windowStart, '+inf'),
               ]);
               const failureCount = Number(failures || 0);
               const requestCount = Number(successes || 0) + failureCount;
               return {
                    service: this.serviceName,
                    state: meta.state || 'CLOSED',
                    failureCount,
                    requestCount,
                    failureRate: requestCount ? failureCount / requestCount : 0,
                    nextAttempt: meta.nextAttempt ? new Date(Number(meta.nextAttempt)).toISOString() : null,
               };
          } catch (_) {
               return {
               service: this.serviceName,
               state: this.state,
               failureCount: this.failureCount,
               requestCount: this.samples.length,
               failureRate: this.samples.length ? this.failureCount / this.samples.length : 0,
               nextAttempt: this.state === 'OPEN' ? new Date(this.nextAttempt).toISOString() : null,
               };
          }
     }
}

// Circuit breakers for each service
const circuitBreakers = {
     userService: new CircuitBreaker('user-service'),
     searchService: new CircuitBreaker('search-service'),
     catalogService: new CircuitBreaker('catalog-service'),
     notificationService: new CircuitBreaker('notification-service'),
     orderService: new CircuitBreaker('order-service'),
     paymentService: new CircuitBreaker('payment-service'),
     inventoryService: new CircuitBreaker('inventory-service'),
     cartService: new CircuitBreaker('cart-service'),
     aiService: new CircuitBreaker('ai-service'),
};


/**
 * Forward request to downstream service
 */
async function forwardRequest(serviceUrl, path, method, data, headers, circuitBreaker, route, requestId) {
     const url = `${serviceUrl}${path}`;
     const forwardedHeaders = Object.fromEntries(
          FORWARDED_HEADERS
               .filter((header) => headers[header] !== undefined)
               .map((header) => [header, headers[header]])
     );
     // http://localhost:4001/auth/login
     const requestConfig = {
          method,
          url,
          timeout: config.SERVICE_TIMEOUT_MS,
          headers: {
               ...forwardedHeaders,
               'x-internal-service-key': config.INTERNAL_SERVICE_KEY,
          },
          validateStatus: (status) => status < 500,
          maxRedirects: 0,
     };

     // Add data based on method
     if (method !== 'GET' && method !== 'DELETE' && data) {
          requestConfig.data = data;
     }

     // For GET and DELETE, add params if data exists
     if ((method === 'GET' || method === 'DELETE') && data) {
          requestConfig.params = data;
     }

          const startedAt = Date.now();

     try {
          const response = await circuitBreaker.execute(() => axios(requestConfig));

          console.info('gateway_request', { requestId, route, service: circuitBreaker.serviceName, method, status: response.status, durationMs: Date.now() - startedAt });

          return {
               status: response.status,
               data: response.data,
               headers: response.headers,
          };
     } catch (err) {
          console.error('gateway_request_failed', {
               requestId,
               route,
               code: err.code,
               status: err.response?.status,
               service: circuitBreaker.serviceName,
               method: method,
               timeout: config.SERVICE_TIMEOUT_MS,
          });

          if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
               throw new GatewayTimeoutError(`Request to ${serviceUrl} timed out after ${config.SERVICE_TIMEOUT_MS}ms`);
          }

          if (err.code === 'ECONNREFUSED') {
               throw new ServiceUnavailableError(`Cannot connect to ${serviceUrl}. Service may be down.`);
          }

          if (err.response) {
               console.error('gateway_downstream_error', {
                    requestId,
                    route,
                    service: circuitBreaker.serviceName,
                    status: err.response.status,
               });

               return {
                    status: err.response.status,
                    data: err.response.data,
                    headers: err.response.headers,
               };
          }

          // Network error or service down--You would have seen this in video
          console.error('gateway_network_error', { requestId, route, service: circuitBreaker.serviceName, code: err.code });
          throw new ServiceUnavailableError(`Service temporarily unavailable: ${err.message}`);
     }
}

/**
 * Proxy middleware factory
 */
function createProxy(serviceName, serviceUrl) {
     const circuitBreaker = circuitBreakers[serviceName];

     if (!circuitBreaker) {
          throw new Error(`No circuit breaker found for service: ${serviceName}`);
     }

     return async (req, res, next) => {
          try {
               const incomingRequestId = req.get('x-request-id') || '';
               const requestId = /^[A-Za-z0-9._:-]{1,100}$/.test(incomingRequestId) ? incomingRequestId : crypto.randomUUID();
               const route = `${req.baseUrl}${req.route?.path || ''}` || 'unmatched';
               req.headers['x-request-id'] = requestId;
               res.setHeader('x-request-id', requestId);
               // Extract path (remove /api prefix only)
               // Gateway: /api/users/auth/login -> Service: /auth/login
               // Gateway: /api/users/user/profile -> Service: /user/profile
               const pathParts = req.path.split('/').filter(Boolean);
               // Remove 'users' (first part), keep the rest
               // ['users', 'auth', 'login'] -> ['auth', 'login'] -> '/auth/login'
               const servicePath = '/' + pathParts.slice(1).join('/');
               const result = await forwardRequest(
                    serviceUrl,
                    servicePath + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''),
                    req.method,
                    req.body,
                    req.headers,
                    circuitBreaker,
                    route,
                    requestId
               );

               // Forward response headers (except some)
               const excludeHeaders = ['connection', 'keep-alive', 'transfer-encoding', 'host'];
               Object.keys(result.headers).forEach((key) => {
                    if (!excludeHeaders.includes(key.toLowerCase())) {
                         res.setHeader(key, result.headers[key]);
                    }
               });

               // Send response
               res.status(result.status).json(result.data);
          } catch (err) {
               next(err);
          }
     };
}

/**
 * Health check endpoint for circuit breakers
 */
async function getCircuitBreakerStatus() {
     return Promise.all(Object.values(circuitBreakers).map((cb) => cb.getState()));
}

module.exports = {
     createProxy,
     CircuitBreaker,
     circuitBreakers,
     getCircuitBreakerStatus,
};
