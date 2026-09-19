const { BadRequestError } = require('../utils/error');
const inventoryService = require('../services/inventory.service');

exports.getStock = async (req, res) => {
     const data = await inventoryService.getStock(req.params.productId);
     res.status(200).json({ success: true, data });
};

exports.getBulkStock = async (req, res) => {
     const { productIds } = req.body;
     if (!productIds || !Array.isArray(productIds)) throw new BadRequestError('productIds (array) is required');
     const data = await inventoryService.getBulkStock(productIds);
     res.status(200).json({ success: true, data });
};

exports.reserveStock = async (req, res) => {
     const { orderId, items, ttlSeconds } = req.body;
     if (!orderId || !items || !Array.isArray(items) || items.length === 0) {
          throw new BadRequestError('orderId and items (non-empty array) are required');
     }
     const result = await inventoryService.reserveStock(orderId, items, ttlSeconds);
     res.status(200).json({ success: true, message: 'Stock reserved', data: result });
};

exports.confirmStock = async (req, res) => {
     const { orderId, items } = req.body;
     if (!orderId || !items) throw new BadRequestError('orderId and items are required');
     const result = await inventoryService.confirmStock(orderId, items);
     res.status(200).json({ success: true, data: result });
};

exports.releaseStock = async (req, res) => {
     const { orderId, items } = req.body;
     if (!orderId || !items) throw new BadRequestError('orderId and items are required');
     const result = await inventoryService.releaseStock(orderId, items);
     res.status(200).json({ success: true, data: result });
};

exports.adjustStock = async (req, res) => {
     const { productId, sku, delta } = req.body;
     if (!productId || delta === undefined) throw new BadRequestError('productId and delta are required');
     const result = await inventoryService.adjustStock(productId, sku, delta);
     res.status(200).json({ success: true, message: 'Stock adjusted', data: result });
};
