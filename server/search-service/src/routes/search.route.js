const { Router } = require('express');
const ctrl = require('../controllers/search.controller');
const router = Router();

// GET /search/products?q=shoes&categoryId=...&minPrice=10&maxPrice=200&sort=price_asc
router.get('/products', ctrl.searchProducts);

// GET /search/autocomplete?q=sho
router.get('/autocomplete', ctrl.autocomplete);

module.exports = router;
