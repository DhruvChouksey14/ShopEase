const express = require('express');
const ctrl = require('../controllers/product.controller');
const { getUserContext, requireAdmin } = require('../middlewares/getUserContext.middleware');
const { internalAuth } = require('../middlewares/internalAuth.middleware');

const router = express.Router();

// Public reads
router.get('/', ctrl.getAllProducts);
router.get('/:productId', ctrl.getProductById);

// Internal — used by order-service/cart-service to hydrate cart items in bulk
router.post('/bulk', internalAuth, ctrl.getProductsByIds);

// Admin-only writes
router.post('/', internalAuth, getUserContext, requireAdmin, ctrl.createProduct);
router.put('/:productId', internalAuth, getUserContext, requireAdmin, ctrl.updateProduct);
router.delete('/:productId', internalAuth, getUserContext, requireAdmin, ctrl.deleteProduct);

module.exports = router;
