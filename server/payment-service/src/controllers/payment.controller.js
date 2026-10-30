const { BadRequestError } = require('../utils/error');
const paymentService = require('../services/payment.service');

exports.createPaymentOrder = async (req, res) => {
     const { orderId, amountPaise, userId, idempotencyKey } = req.body;

     if (!orderId || !amountPaise || !userId || !idempotencyKey) {
          throw new BadRequestError('orderId, amountPaise, userId, and idempotencyKey are required');
     }

     const result = await paymentService.createPaymentOrder(orderId, amountPaise, userId, idempotencyKey);

     res.status(201).json({ success: true, data: result });
};

exports.getPaymentOrder = async (req, res) => {
     const { paymentOrderId } = req.params;

     const result = await paymentService.getPaymentOrder(paymentOrderId);

     res.status(200).json({ success: true, data: result });
};

exports.cancelPaymentOrder = async (req, res) => {
     const result = await paymentService.cancelPaymentOrder(req.params.paymentOrderId);
     res.status(200).json({ success: true, data: result });
};

exports.verifyAndCapturePayment = async (req, res) => {
     const { paymentOrderId } = req.params;
     const { gatewayPaymentId, gatewaySignature } = req.body;

     if (!gatewayPaymentId || !gatewaySignature) {
          throw new BadRequestError('gatewayPaymentId and gatewaySignature are required');
     }

     const result = await paymentService.verifyAndCapturePayment(
          paymentOrderId,
          gatewayPaymentId,
          gatewaySignature
     );

     res.status(200).json({ success: true, data: result });
};

exports.initiateRefund = async (req, res) => {
     const { paymentOrderId, amountPaise, reason, idempotencyKey } = req.body;

     if (!paymentOrderId || !amountPaise || !idempotencyKey) {
          throw new BadRequestError('paymentOrderId, amountPaise, and idempotencyKey are required');
     }

     const result = await paymentService.initiateRefund(paymentOrderId, amountPaise, reason, idempotencyKey);

     res.status(201).json({ success: true, data: result });
};
