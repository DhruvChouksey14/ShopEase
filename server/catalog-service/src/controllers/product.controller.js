const { BadRequestError } = require('../utils/error');
const productService = require('../services/product.service');

exports.createProduct = async (req, res) => {
     const product = await productService.createProduct(req.body);
     res.status(201).json({ success: true, message: 'Product created', data: product });
};

exports.updateProduct = async (req, res) => {
     const product = await productService.updateProduct(req.params.productId, req.body);
     res.status(200).json({ success: true, message: 'Product updated', data: product });
};

exports.deleteProduct = async (req, res) => {
     await productService.deleteProduct(req.params.productId);
     res.status(200).json({ success: true, message: 'Product deactivated' });
};

exports.getAllProducts = async (req, res) => {
     const { categoryId, page, limit, includeInactive } = req.query;
     const result = await productService.getAllProducts({
          categoryId,
          page: page ? parseInt(page, 10) : 1,
          limit: limit ? parseInt(limit, 10) : 20,
          includeInactive: includeInactive === 'true',
     });
     res.status(200).json({ success: true, data: result });
};

exports.getProductById = async (req, res) => {
     const product = await productService.getProductById(req.params.productId);
     res.status(200).json({ success: true, data: product });
};

exports.getProductsByIds = async (req, res) => {
     const { ids } = req.body;
     if (!ids || !Array.isArray(ids)) throw new BadRequestError('ids (array) is required');
     const products = await productService.getProductsByIds(ids);
     res.status(200).json({ success: true, data: products });
};
