const express = require('express');
const ctrl = require('../controllers/cart.controller');
const { getUserContext } = require('../middlewares/getUserContext.middleware');
const { internalAuth } = require('../middlewares/internalAuth.middleware');

const router = express.Router();

// Internal — used by order-service at checkout
router.get('/internal/:userId', internalAuth, ctrl.getRawCartInternal);
router.delete('/internal/:userId', internalAuth, ctrl.clearCartInternal);

// Customer-facing (through gateway)
router.use(internalAuth);
router.use(getUserContext);
router.get('/', ctrl.getCart);
router.post('/items', ctrl.addItem);
router.put('/items/:productId', ctrl.updateItem);
router.delete('/items/:productId', ctrl.removeItem);
router.delete('/', ctrl.clearCart);

module.exports = router;
