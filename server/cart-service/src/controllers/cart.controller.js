const { BadRequestError } = require('../utils/error');
const cartService = require('../services/cart.service');

exports.getCart = async (req, res) => {
     const cart = await cartService.getCart(req.user.id);
     res.status(200).json({ success: true, data: cart });
};

exports.addItem = async (req, res) => {
     const { productId, quantity } = req.body;
     const cart = await cartService.addItem(req.user.id, productId, quantity || 1);
     res.status(200).json({ success: true, message: 'Item added to cart', data: cart });
};

exports.updateItem = async (req, res) => {
     const { quantity } = req.body;
     if (quantity === undefined) throw new BadRequestError('quantity is required');
     const cart = await cartService.updateItem(req.user.id, req.params.productId, quantity);
     res.status(200).json({ success: true, data: cart });
};

exports.removeItem = async (req, res) => {
     const cart = await cartService.removeItem(req.user.id, req.params.productId);
     res.status(200).json({ success: true, data: cart });
};

exports.clearCart = async (req, res) => {
     const cart = await cartService.clearCart(req.user.id);
     res.status(200).json({ success: true, data: cart });
};

// ─── Internal (called by order-service during checkout) ─────────────────────

exports.getRawCartInternal = async (req, res) => {
     const cart = await cartService.getRawCart(req.params.userId);
     res.status(200).json({ success: true, data: cart });
};

exports.clearCartInternal = async (req, res) => {
     await cartService.clearCart(req.params.userId);
     res.status(200).json({ success: true, message: 'Cart cleared' });
};
