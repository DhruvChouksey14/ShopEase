const Razorpay = require('razorpay');
const crypto = require('crypto');
const BaseGateway = require('./base.gateway');

class RazorpayGateway extends BaseGateway {
     constructor(keyId, keySecret, webhookSecret) {
          super('razorpay');
          this.keyId = keyId;
          this.keySecret = keySecret;
          this.webhookSecret = webhookSecret;
          this.client = new Razorpay({
               key_id: keyId,
               key_secret: keySecret,
          });
     }

     async createOrder(amountPaise, currency, receipt, notes = {}) {

          let order;
          try {
               order = await this.client.orders.create({
                    amount: amountPaise,
                    currency,
                    receipt,
                    notes,
               });
          } catch (err) {
               // Razorpay SDK throws plain objects, not Error instances
               const description = err?.error?.description || err?.message || JSON.stringify(err);
               console.error(`Razorpay createOrder failed: ${description}`);
               const { BadRequestError } = require('../../utils/error');
               throw new BadRequestError(`Payment gateway error: ${description}`, 'PAYMENT_GATEWAY_ERROR');
          }

          console.log(`Razorpay order created: ${order.id}`, { receipt, amountPaise });

          return {
               gatewayOrderId: order.id,
               amountPaise: order.amount,
               currency: order.currency,
               receipt: order.receipt,
               rawResponse: order,
          };
     }

     verifyPaymentSignature(orderId, paymentId, signature) {
          const body = `${orderId}|${paymentId}`;
          const expectedSignature = crypto
               .createHmac('sha256', this.keySecret)
               .update(body)
               .digest('hex');

          if (typeof signature !== 'string' || !/^[0-9a-f]+$/i.test(signature) || signature.length !== expectedSignature.length) return false;

          try {
               return crypto.timingSafeEqual(
                    Buffer.from(expectedSignature, 'hex'),
                    Buffer.from(signature, 'hex')
               );
          } catch {
               return false;
          }
     }

     verifyWebhookSignature(rawBody, signature) {
          const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
          const expectedSignature = crypto
               .createHmac('sha256', this.webhookSecret)
               .update(body)
               .digest('hex');

          try {
               return crypto.timingSafeEqual(
                    Buffer.from(expectedSignature, 'hex'),
                    Buffer.from(signature, 'hex')
               );
          } catch {
               return false;
          }
     }

     async fetchPayment(paymentId) {
          const payment = await this.client.payments.fetch(paymentId);

          return {
               status: payment.status,
               amountPaise: payment.amount,
               method: payment.method,
               rawResponse: payment,
          };
     }

     async fetchOrderPayments(orderId) {
          return this.client.orders.fetchPayments(orderId);
     }

     async initiateRefund(paymentId, amountPaise, { reason, orderId, idempotencyKey } = {}) {
          if (!idempotencyKey || !/^[A-Za-z0-9_-]{10,}$/.test(idempotencyKey)) throw new Error('A valid Razorpay refund idempotency key is required');
          const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
               method: 'POST',
               headers: {
                    Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
                    'Content-Type': 'application/json',
                    'X-Refund-Idempotency': idempotencyKey,
               },
               body: JSON.stringify({ amount: amountPaise, notes: { reason, orderId } }),
               signal: AbortSignal.timeout(15000),
          });
          const refund = await response.json();
          if (!response.ok) {
               const error = new Error(refund.error?.description || `Razorpay refund failed (${response.status})`);
               error.status = response.status;
               error.gatewayError = refund.error;
               throw error;
          }

          console.log(`Razorpay refund initiated: ${refund.id}`, { paymentId, amountPaise });

          return {
               gatewayRefundId: refund.id,
               status: refund.status,
               amountPaise: refund.amount,
               rawResponse: refund,
          };
     }

     async fetchRefund(paymentId, refundId) {
          const refund = await this.client.payments.fetchRefund(paymentId, refundId);

          return {
               status: refund.status,
               amountPaise: refund.amount,
               rawResponse: refund,
          };
     }
}

module.exports = RazorpayGateway;
