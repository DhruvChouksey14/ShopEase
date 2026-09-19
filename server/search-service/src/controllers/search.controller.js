const { BadRequestError } = require('../utils/error');
const searchService = require('../services/search.service');

exports.searchProducts = async (req, res) => {
     const { q, categoryId, minPrice, maxPrice, inStockOnly, sort, page, limit } = req.query;
     const results = await searchService.searchProducts({
          q,
          categoryId,
          minPrice: minPrice ? parseFloat(minPrice) : undefined,
          maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
          inStockOnly: inStockOnly === 'true',
          sort,
          page: page ? parseInt(page, 10) : 1,
          limit: limit ? parseInt(limit, 10) : 20,
     });
     res.json({ success: true, data: results });
};

exports.autocomplete = async (req, res) => {
     const { q } = req.query;
     if (!q || q.length < 2) throw new BadRequestError('Provide at least 2 characters');
     const suggestions = await searchService.autocomplete(q);
     res.json({ success: true, data: suggestions });
};
