const express = require('express');
const ctrl = require('../controllers/order.controller');
const { getUserContext, requireAdmin } = require('../middlewares/getUserContext.middleware');
const { internalAuth } = require('../middlewares/internalAuth.middleware');

const router = express.Router();

// internalAuth verifies the shared x-internal-service-key, so this service only
// trusts x-user-id/x-user-role when the request genuinely came through the gateway
// (or another trusted internal caller) — matches the same pattern used by
// cart-service, catalog-service, and inventory-service.
router.use(internalAuth);
router.use(getUserContext);

router.post('/', ctrl.createOrder);
router.get('/', ctrl.getUserOrders);
router.get('/:orderId', ctrl.getOrder);
router.post('/:orderId/verify-payment', ctrl.verifyPayment);
router.post('/:orderId/cancel', ctrl.cancelOrder);

// Admin
router.get('/admin/all', requireAdmin, ctrl.getAllOrders);
router.post('/:orderId/ship', requireAdmin, ctrl.markShipped);

module.exports = router;
