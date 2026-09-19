const express = require('express');
const { getUserContext, requireAdmin } = require('../middlewares/getUserContext.middleware');
const { internalAuth } = require('../middlewares/internalAuth.middleware');
const ctrl = require('../controllers/inventory.controller');

const router = express.Router();

// Public read
router.get('/products/:productId', ctrl.getStock);
router.post('/products/bulk', ctrl.getBulkStock);

// Internal — called by order-service saga
router.post('/reserve', internalAuth, ctrl.reserveStock);
router.post('/confirm', internalAuth, ctrl.confirmStock);
router.post('/release', internalAuth, ctrl.releaseStock);

// Admin — restock
router.post('/adjust', internalAuth, getUserContext, requireAdmin, ctrl.adjustStock);

module.exports = router;
