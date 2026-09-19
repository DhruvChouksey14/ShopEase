const paymentService = require('../services/payment.service');
/**
 * Razorpay webhook handler.
 * IMPORTANT: This endpoint receives raw body (not JSON-parsed)
 * for signature verification. The route must use express.raw().
 */
exports.razorpayWebhook = async (req, res) => {
     const signature = req.headers['x-razorpay-signature'];

     if (!signature) {
          console.warn('Webhook received without signature header');
          return res.status(400).json({ status: 'error', message: 'Missing signature' });
     }

     const rawBody = req.body;

     const result = await paymentService.handleWebhook(rawBody, signature);

     console.log('Webhook processed', { result });

     // Always return 200 to the gateway to prevent retries for processed events
     res.status(200).json({ status: 'ok', ...result });
};
