/**
 * Prometheus metrics middleware — shared across every service.
 * Exposes default Node.js process metrics plus an HTTP request duration
 * histogram labelled by method/route/status, scraped by Prometheus
 * (see docker/prometheus.yml) and visualised in Grafana.
 */
const client = require('prom-client');

function createMetrics(serviceName) {
     const register = new client.Registry();
     register.setDefaultLabels({ service: serviceName });
     client.collectDefaultMetrics({ register });

     const httpRequestDuration = new client.Histogram({
          name: 'http_request_duration_seconds',
          help: 'Duration of HTTP requests in seconds',
          labelNames: ['method', 'route', 'status_code'],
          buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
          registers: [register],
     });

     const httpRequestsTotal = new client.Counter({
          name: 'http_requests_total',
          help: 'Total number of HTTP requests',
          labelNames: ['method', 'route', 'status_code'],
          registers: [register],
     });

     const metricsMiddleware = (req, res, next) => {
          const end = httpRequestDuration.startTimer();
          res.on('finish', () => {
               const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
               const labels = { method: req.method, route, status_code: res.statusCode };
               end(labels);
               httpRequestsTotal.inc(labels);
          });
          next();
     };

     const metricsHandler = async (req, res) => {
          res.set('Content-Type', register.contentType);
          res.end(await register.metrics());
     };

     return { register, metricsMiddleware, metricsHandler };
}

module.exports = { createMetrics };
