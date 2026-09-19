const express = require('express');
const ctrl = require('../controllers/category.controller');
const { getUserContext, requireAdmin } = require('../middlewares/getUserContext.middleware');
const { internalAuth } = require('../middlewares/internalAuth.middleware');

const router = express.Router();

// Public reads (through gateway, no auth required)
router.get('/', ctrl.getAllCategories);
router.get('/:categoryId', ctrl.getCategoryById);

// Admin-only writes
router.post('/', internalAuth, getUserContext, requireAdmin, ctrl.createCategory);
router.put('/:categoryId', internalAuth, getUserContext, requireAdmin, ctrl.updateCategory);
router.delete('/:categoryId', internalAuth, getUserContext, requireAdmin, ctrl.deleteCategory);

module.exports = router;
