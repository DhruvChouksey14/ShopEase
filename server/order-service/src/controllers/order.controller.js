const { BadRequestError } = require('../utils/error');
const orderService = require('../services/order.service');

exports.createOrder = async (req, res) => {
     const { shippingAddress, idempotencyKey } = req.body;
     const result = await orderService.createOrder(req.user.id, shippingAddress, idempotencyKey);
     res.status(201).json({ success: true, message: 'Order created', data: result });
};

exports.verifyPayment = async (req, res) => {
     const { razorpayPaymentId, razorpaySignature } = req.body;
     if (!razorpayPaymentId || !razorpaySignature) throw new BadRequestError('razorpayPaymentId and razorpaySignature are required');
     const result = await orderService.verifyPayment(req.params.orderId, req.user.id, razorpayPaymentId, razorpaySignature);
     res.status(200).json({ success: true, data: result });
};

exports.cancelOrder = async (req, res) => {
     const result = await orderService.cancelOrder(req.params.orderId, req.user.id);
     res.status(200).json({ success: true, message: 'Order cancelled', data: result });
};

exports.getOrder = async (req, res) => {
     const isAdmin = req.user.role === 'ADMIN';
     const order = await orderService.getOrder(req.params.orderId, req.user.id, isAdmin);
     res.status(200).json({ success: true, data: order });
};

exports.getUserOrders = async (req, res) => {
     const { status, page, limit } = req.query;
     const result = await orderService.getUserOrders(req.user.id, {
          status,
          page: page ? parseInt(page, 10) : 1,
          limit: limit ? parseInt(limit, 10) : 10,
     });
     res.status(200).json({ success: true, data: result });
};

exports.getAllOrders = async (req, res) => {
     const { status, page, limit } = req.query;
     const result = await orderService.getAllOrders({
          status,
          page: page ? parseInt(page, 10) : 1,
          limit: limit ? parseInt(limit, 10) : 20,
     });
     res.status(200).json({ success: true, data: result });
};

exports.markShipped = async (req, res) => {
     const { trackingNumber } = req.body;
     const result = await orderService.markShipped(req.params.orderId, trackingNumber);
     res.status(200).json({ success: true, message: 'Order marked as shipped', data: result });
};
