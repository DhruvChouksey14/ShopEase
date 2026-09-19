const express = require('express');
const { requireAuth, requireAdmin } = require('../middlewares/auth.middleware');
const { createProxy, getCircuitBreakerStatus } = require('../services/proxy');
const { endpointRateLimit, combinedRateLimit } = require('../middlewares/rateLimiting.middleware');
const { config } = require('../config');

const router = express.Router();

// ===========================
// USER SERVICE ROUTES (auth, profile, Google sign-in)
// ===========================
const userServiceProxy = createProxy('userService', config.SERVICES.USER_SERVICE_URL);

router.post('/users/auth/send-otp', endpointRateLimit(5, 3600000), userServiceProxy);
router.post('/users/auth/verify-otp', endpointRateLimit(10, 3600000), userServiceProxy);
router.post('/users/auth/login', endpointRateLimit(100, 900000), userServiceProxy);
router.post('/users/auth/google-auth', endpointRateLimit(10, 900000), userServiceProxy);
router.post('/users/auth/refresh', endpointRateLimit(20, 900000), userServiceProxy);
router.post('/users/auth/logout', requireAuth, combinedRateLimit(), userServiceProxy);

router.get('/users/user/profile', requireAuth, combinedRateLimit(), userServiceProxy);
router.put('/users/user/profile', requireAuth, combinedRateLimit(), userServiceProxy);
router.delete('/users/user/profile', requireAuth, combinedRateLimit(), userServiceProxy);

// ===========================
// CATALOG SERVICE ROUTES (categories/products — reads public, writes admin-only)
// ===========================
const catalogServiceProxy = createProxy('catalogService', config.SERVICES.CATALOG_SERVICE_URL);

router.get('/catalog/categories', endpointRateLimit(120, 60000), catalogServiceProxy);
router.get('/catalog/categories/:categoryId', endpointRateLimit(120, 60000), catalogServiceProxy);
router.post('/catalog/categories', requireAuth, requireAdmin, combinedRateLimit(), catalogServiceProxy);
router.put('/catalog/categories/:categoryId', requireAuth, requireAdmin, combinedRateLimit(), catalogServiceProxy);
router.delete('/catalog/categories/:categoryId', requireAuth, requireAdmin, combinedRateLimit(), catalogServiceProxy);

router.get('/catalog/products', endpointRateLimit(120, 60000), catalogServiceProxy);
router.get('/catalog/products/:productId', endpointRateLimit(120, 60000), catalogServiceProxy);
router.post('/catalog/products', requireAuth, requireAdmin, combinedRateLimit(), catalogServiceProxy);
router.put('/catalog/products/:productId', requireAuth, requireAdmin, combinedRateLimit(), catalogServiceProxy);
router.delete('/catalog/products/:productId', requireAuth, requireAdmin, combinedRateLimit(), catalogServiceProxy);

// ===========================
// SEARCH SERVICE ROUTES (public, Elasticsearch-backed)
// ===========================
const searchServiceProxy = createProxy('searchService', config.SERVICES.SEARCH_SERVICE_URL);

router.get('/search/products', endpointRateLimit(60, 60000), searchServiceProxy);
router.get('/search/autocomplete', endpointRateLimit(120, 60000), searchServiceProxy);

// ===========================
// INVENTORY SERVICE ROUTES (public read-only stock check)
// ===========================
const inventoryServiceProxy = createProxy('inventoryService', config.SERVICES.INVENTORY_SERVICE_URL);

router.get('/inventory/products/:productId', endpointRateLimit(120, 60000), inventoryServiceProxy);
router.post('/inventory/products/bulk', endpointRateLimit(120, 60000), inventoryServiceProxy);
router.post('/inventory/adjust', requireAuth, requireAdmin, combinedRateLimit(), inventoryServiceProxy);
// Note: reserve/confirm/release are internal-only (called by order-service directly)

// ===========================
// CART SERVICE ROUTES
// ===========================
const cartServiceProxy = createProxy('cartService', config.SERVICES.CART_SERVICE_URL);

router.get('/cart', requireAuth, combinedRateLimit(), cartServiceProxy);
router.post('/cart/items', requireAuth, combinedRateLimit(), cartServiceProxy);
router.put('/cart/items/:productId', requireAuth, combinedRateLimit(), cartServiceProxy);
router.delete('/cart/items/:productId', requireAuth, combinedRateLimit(), cartServiceProxy);
router.delete('/cart', requireAuth, combinedRateLimit(), cartServiceProxy);

// ===========================
// ORDER SERVICE ROUTES (checkout saga, cancellation, history)
// ===========================
const orderServiceProxy = createProxy('orderService', config.SERVICES.ORDER_SERVICE_URL);

router.post('/orders', requireAuth, endpointRateLimit(5, 60000), orderServiceProxy); // 5 checkout attempts/min
router.get('/orders', requireAuth, combinedRateLimit(), orderServiceProxy);
router.get('/orders/admin/all', requireAuth, requireAdmin, combinedRateLimit(), orderServiceProxy);
router.get('/orders/:orderId', requireAuth, combinedRateLimit(), orderServiceProxy);
router.post('/orders/:orderId/verify-payment', requireAuth, combinedRateLimit(), orderServiceProxy);
router.post('/orders/:orderId/cancel', requireAuth, combinedRateLimit(), orderServiceProxy);
router.post('/orders/:orderId/ship', requireAuth, requireAdmin, combinedRateLimit(), orderServiceProxy);

// ===========================
// PAYMENT SERVICE ROUTES (webhook only — public, signature-verified downstream)
// ===========================
const paymentServiceProxy = createProxy('paymentService', config.SERVICES.PAYMENT_SERVICE_URL);

router.post('/payments/webhooks/razorpay', paymentServiceProxy);

// ===========================
// Gateway Health / Observability
// ===========================
router.get('/gateway/health', (req, res) => {
     res.status(200).json({ success: true, message: 'API Gateway is healthy', timestamp: new Date().toISOString() });
});

router.get('/gateway/circuit-breakers', (req, res) => {
     res.status(200).json({ success: true, circuitBreakers: getCircuitBreakerStatus() });
});

module.exports = router;
