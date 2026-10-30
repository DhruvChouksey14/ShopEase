const prisma = require('../config/prisma');
const paymentProducer = require('../kafka/producer/payment.producer');
const { getGateway } = require('./gateways/gateway.factory');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/error');
const { config } = require('../config');

const queueOutbox = async (tx, eventType, eventKey, payload) => tx.paymentOutbox.upsert({
     where: { eventKey }, update: {}, create: { eventKey, eventType, payload },
});

const processPaymentOutbox = async (limit = 50) => {
     await prisma.paymentOutbox.updateMany({ where: { status: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - 60000) } }, data: { status: 'PENDING' } });
     const events = await prisma.paymentOutbox.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: 'asc' }, take: limit });
     for (const event of events) {
          const claimed = await prisma.paymentOutbox.updateMany({ where: { id: event.id, status: 'PENDING' }, data: { status: 'PROCESSING' } });
          if (!claimed.count) continue;
          try {
               await paymentProducer.publishOutboxEvent(event.eventType, event.payload, event.eventKey);
               await prisma.paymentOutbox.update({ where: { id: event.id }, data: { status: 'DELIVERED', lastError: null } });
          } catch (err) {
               const attempts = event.attempts + 1;
               await prisma.paymentOutbox.update({ where: { id: event.id }, data: { status: 'PENDING', attempts, lastError: err.message, nextAttemptAt: new Date(Date.now() + Math.min(3600000, 1000 * (2 ** Math.min(attempts, 12)))) } });
               console.error('Payment outbox delivery will retry', { eventId: event.id, attempts, error: err.message });
          }
     }
};

// ─── Idempotency Helper ──────────────────────────────────────────────────────

const withIdempotency = async (key, fn) => {
     const existing = await prisma.idempotencyRecord.findUnique({ where: { eventKey: key } });
     if (existing) {
          console.log(`Idempotent request detected: ${key}`);
          if (key.startsWith('payment-order:') && existing.response?.amountPaise == null) {
               const amountPaise = Math.round(Number(existing.response.amount) * 100);
               return { ...existing.response, amount: amountPaise, amountPaise, amountRupees: amountPaise / 100 };
          }
          return existing.response;
     }

     const result = await fn();

     try {
          await prisma.idempotencyRecord.create({ data: { eventKey: key, response: result } });
     } catch (error) {
          if (error.code !== 'P2002') throw error;
          const concurrent = await prisma.idempotencyRecord.findUnique({ where: { eventKey: key } });
          if (!concurrent) throw error;
          return concurrent.response;
     }

     return result;
};

// ─── Create Payment Order ────────────────────────────────────────────────────

const createPaymentOrder = async (orderId, amountPaise, userId, idempotencyKey) => {
     if (!orderId || !Number.isSafeInteger(amountPaise) || !userId || !idempotencyKey) {
          throw new BadRequestError('orderId, integer amountPaise, userId, and idempotencyKey are required');
     }

     if (amountPaise <= 0) {
          throw new BadRequestError('Amount must be greater than 0');
     }

     return withIdempotency(`payment-order:${idempotencyKey}`, async () => {
          const gateway = getGateway();

          // Create order with gateway
          const gatewayResult = await gateway.createOrder(amountPaise, 'INR', orderId, {
               orderId,
               userId,
          });

          // Create payment order record
          const paymentOrder = await prisma.paymentOrder.create({
               data: {
                    orderId,
                    userId,
                    amountPaise,
                    currency: 'INR',
                    status: 'CREATED',
                    idempotencyKey,
                    gatewayProvider: config.PAYMENT_GATEWAY,
                    gatewayOrderId: gatewayResult.gatewayOrderId,
               },
          });

          // Audit log
          await prisma.paymentAuditLog.create({
               data: {
                    paymentOrderId: paymentOrder.id,
                    action: 'ORDER_CREATED',
                    gatewayResponse: gatewayResult.rawResponse,
                    metadata: { orderId, userId, amountPaise },
               },
          });

          console.log(`Payment order created: ${paymentOrder.id}`, {
               orderId,
               gatewayOrderId: gatewayResult.gatewayOrderId,
          });

          return {
               paymentOrderId: paymentOrder.id,
               gatewayOrderId: gatewayResult.gatewayOrderId,
               amount: paymentOrder.amountPaise,
               amountPaise: paymentOrder.amountPaise,
               amountRupees: paymentOrder.amountPaise / 100,
               currency: paymentOrder.currency,
               status: paymentOrder.status,
               gatewayProvider: paymentOrder.gatewayProvider,
               keyId: config.RAZORPAY_KEY_ID,
          };
     });
};

// ─── Handle Webhook ──────────────────────────────────────────────────────────

const handleWebhook = async (rawBody, signature) => {
     const gateway = getGateway();

     // Verify signature
     const isValid = gateway.verifyWebhookSignature(rawBody, signature);
     if (!isValid) {
          console.warn('Webhook signature verification failed');
          throw new BadRequestError('Invalid webhook signature', 'INVALID_SIGNATURE');
     }

     const payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));
     const event = payload.event;
     const paymentEntity = payload.payload?.payment?.entity;

     if (!paymentEntity) {
          console.warn('Webhook payload missing payment entity', { event });
          return { status: 'ignored', event };
     }

     const gatewayOrderId = paymentEntity.order_id;
     const gatewayPaymentId = paymentEntity.id;

     // Find payment order
     const paymentOrder = await prisma.paymentOrder.findUnique({
          where: { gatewayOrderId },
     });

     if (!paymentOrder) {
          console.warn(`Payment order not found for gateway order: ${gatewayOrderId}`);
          return { status: 'ignored', reason: 'order_not_found' };
     }

     // Audit log the webhook
     await prisma.paymentAuditLog.create({
          data: {
               paymentOrderId: paymentOrder.id,
               action: `WEBHOOK_${event.toUpperCase().replace(/\./g, '_')}`,
               gatewayResponse: payload,
          },
     });

     if (event === 'payment.captured') {
          return handlePaymentCaptured(paymentOrder, gatewayPaymentId, paymentEntity);
     }
     if (event === 'payment.authorized') return { status: 'authorized_pending_capture' };

     if (event === 'payment.failed') {
          return handlePaymentFailed(paymentOrder, gatewayPaymentId, paymentEntity);
     }

     if (event === 'refund.processed' || event === 'refund.created') {
          return handleRefundProcessed(paymentOrder, payload.payload?.refund?.entity);
     }

     console.log(`Webhook event ignored: ${event}`);
     return { status: 'ignored', event };
};

const handlePaymentCaptured = async (paymentOrder, gatewayPaymentId, paymentEntity) => {
     // Idempotent: already captured
     if (paymentOrder.status === 'CAPTURED') {
          console.log(`Payment already captured: ${paymentOrder.id}`);
          return { status: 'already_processed' };
     }

     if (!['CREATED', 'CANCELLED'].includes(paymentOrder.status)) {
          console.warn(`Cannot capture payment in status: ${paymentOrder.status}`, {
               paymentOrderId: paymentOrder.id,
          });
          return { status: 'invalid_state', currentStatus: paymentOrder.status };
     }
     const expectedPaise = paymentOrder.amountPaise;
     if (Number(paymentEntity.amount) !== expectedPaise) throw new ConflictError('Captured payment amount does not match payment order', 'PAYMENT_AMOUNT_MISMATCH');

     // Update payment order
     const capturedPayload = {
          paymentOrderId: paymentOrder.id,
          orderId: paymentOrder.orderId,
          gatewayPaymentId,
          amount: paymentOrder.amountPaise / 100,
          capturedAt: new Date().toISOString(),
     };
     await prisma.$transaction(async (tx) => {
          const updated = await tx.paymentOrder.updateMany({ where: { id: paymentOrder.id, status: { in: ['CREATED', 'CANCELLED'] } }, data: {
               status: 'CAPTURED',
               gatewayPaymentId,
               gatewaySignature: paymentEntity.acquirer_data?.auth_code || null,
               version: { increment: 1 },
          } });
          if (!updated.count) throw new ConflictError('Payment state changed while capturing', 'PAYMENT_STATE_CHANGED');
          await queueOutbox(tx, 'PAYMENT_SUCCESS', `payment-${paymentOrder.id}`, capturedPayload);
     });

     console.log(`Payment captured: ${paymentOrder.id}`, { gatewayPaymentId });

     // Publish PAYMENT_SUCCESS to Kafka
     await processPaymentOutbox().catch((err) => console.error('Outbox processing deferred', { error: err.message }));

     return { status: 'captured', paymentOrderId: paymentOrder.id };
};

const handlePaymentFailed = async (paymentOrder, gatewayPaymentId, paymentEntity) => {
     // Idempotent: already failed
     if (paymentOrder.status === 'FAILED') {
          return { status: 'already_processed' };
     }

     if (paymentOrder.status !== 'CREATED') {
          return { status: 'invalid_state', currentStatus: paymentOrder.status };
     }

     const reason = paymentEntity.error_description || paymentEntity.error_reason || 'payment_failed';

     await prisma.$transaction(async (tx) => {
     const updated = await tx.paymentOrder.updateMany({
          where: { id: paymentOrder.id, status: 'CREATED' },
          data: {
               status: 'FAILED',
               gatewayPaymentId,
               failureReason: reason,
               version: { increment: 1 },
          },
     });
     if (!updated.count) return;
     await queueOutbox(tx, 'PAYMENT_FAILED', `payment-${paymentOrder.id}-failed`, { paymentOrderId: paymentOrder.id, orderId: paymentOrder.orderId, reason, failedAt: new Date().toISOString() });
     });

     console.log(`Payment failed: ${paymentOrder.id}`, { reason });

     // Publish PAYMENT_FAILED to Kafka
     await processPaymentOutbox().catch((err) => console.error('Outbox processing deferred', { error: err.message }));

     return { status: 'failed', paymentOrderId: paymentOrder.id };
};

const handleRefundProcessed = async (paymentOrder, refundEntity) => {
     if (!refundEntity) return { status: 'ignored', reason: 'no_refund_entity' };

     const gatewayRefundId = refundEntity.id;

     const refund = await prisma.refund.findUnique({
          where: { gatewayRefundId },
     });

     if (refund) {
          await prisma.refund.update({
               where: { id: refund.id },
               data: { status: 'COMPLETED' },
          });

          // Update parent payment order status
          const allRefunds = await prisma.refund.findMany({
               where: { paymentOrderId: paymentOrder.id },
          });

          const totalRefunded = allRefunds
               .filter(r => r.status === 'COMPLETED' || r.id === refund.id)
               .reduce((sum, r) => sum + r.amountPaise, 0);

          const newStatus = totalRefunded >= paymentOrder.amountPaise ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

          await prisma.paymentOrder.update({
               where: { id: paymentOrder.id },
               data: { status: newStatus, version: { increment: 1 } },
          });

          console.log(`Refund processed: ${gatewayRefundId}`, { newStatus });
     }

     return { status: 'refund_processed', gatewayRefundId };
};

// ─── Verify and Capture (client-side verification) ───────────────────────────

const verifyAndCapturePayment = async (paymentOrderId, gatewayPaymentId, gatewaySignature) => {
     if (!paymentOrderId || !gatewayPaymentId || !gatewaySignature) {
          throw new BadRequestError('paymentOrderId, gatewayPaymentId, and gatewaySignature are required');
     }

     const paymentOrder = await prisma.paymentOrder.findUnique({
          where: { id: paymentOrderId },
     });

     if (!paymentOrder) {
          throw new NotFoundError('Payment order not found');
     }

     // Idempotent
     if (paymentOrder.status === 'CAPTURED') {
          return {
               paymentOrderId: paymentOrder.id,
               status: 'CAPTURED',
               gatewayPaymentId: paymentOrder.gatewayPaymentId,
               message: 'Payment already captured',
          };
     }

     if (paymentOrder.status !== 'CREATED') {
          throw new ConflictError(`Payment order is in ${paymentOrder.status} status`);
     }

     const gateway = getGateway();

     // Verify signature
     const isValid = gateway.verifyPaymentSignature(
          paymentOrder.gatewayOrderId,
          gatewayPaymentId,
          gatewaySignature
     );

     if (isValid) {
          const gatewayPayment = await gateway.fetchPayment(gatewayPaymentId);
          if (gatewayPayment.status !== 'captured') return { paymentOrderId, status: 'AUTHORIZED_PENDING_CAPTURE', gatewayPaymentId };
          if (gatewayPayment.amountPaise !== paymentOrder.amountPaise) throw new ConflictError('Gateway payment amount does not match payment order', 'PAYMENT_AMOUNT_MISMATCH');
     }

     // Audit log the verification attempt
     await prisma.paymentAuditLog.create({
          data: {
               paymentOrderId: paymentOrder.id,
               action: isValid ? 'SIGNATURE_VERIFIED' : 'SIGNATURE_VERIFICATION_FAILED',
               metadata: { gatewayPaymentId, isValid },
          },
     });

     if (!isValid) {
          const reason = 'signature_verification_failed';
          await prisma.$transaction(async (tx) => {
          const updated = await tx.paymentOrder.updateMany({
               where: { id: paymentOrder.id, status: 'CREATED' },
               data: {
                    status: 'FAILED',
                    failureReason: 'signature_verification_failed',
                    version: { increment: 1 },
               },
          });
          if (updated.count) await queueOutbox(tx, 'PAYMENT_FAILED', `payment-${paymentOrder.id}-failed`, { paymentOrderId: paymentOrder.id, orderId: paymentOrder.orderId, reason, failedAt: new Date().toISOString() });
          });

          // Publish failure
          await processPaymentOutbox().catch((err) => console.error('Outbox processing deferred', { error: err.message }));

          throw new BadRequestError('Payment signature verification failed', 'INVALID_SIGNATURE');
     }

     // Signature valid — capture payment
     const successEvent = {
          paymentOrderId: paymentOrder.id,
          orderId: paymentOrder.orderId,
          gatewayPaymentId,
          amount: paymentOrder.amountPaise / 100,
          capturedAt: new Date().toISOString(),
     };
     await prisma.$transaction(async (tx) => {
     const updated = await tx.paymentOrder.updateMany({
          where: { id: paymentOrder.id, status: 'CREATED' },
          data: {
               status: 'CAPTURED',
               gatewayPaymentId,
               gatewaySignature,
               version: { increment: 1 },
          },
     });
     if (!updated.count) throw new ConflictError('Payment state changed while capturing', 'PAYMENT_STATE_CHANGED');
     await queueOutbox(tx, 'PAYMENT_SUCCESS', `payment-${paymentOrder.id}`, successEvent);
     });

     await prisma.paymentAuditLog.create({
          data: {
               paymentOrderId: paymentOrder.id,
               action: 'PAYMENT_CAPTURED_VIA_VERIFY',
               metadata: { gatewayPaymentId },
          },
     });

     console.log(`Payment captured via verify: ${paymentOrder.id}`);

     // Publish PAYMENT_SUCCESS
     await processPaymentOutbox().catch((err) => console.error('Outbox processing deferred', { error: err.message }));

     return {
          paymentOrderId: paymentOrder.id,
          status: 'CAPTURED',
          gatewayPaymentId,
     };
};

// ─── Initiate Refund ─────────────────────────────────────────────────────────

const initiateRefund = async (paymentOrderId, amountPaise, reason, idempotencyKey) => {
     if (!paymentOrderId || !Number.isSafeInteger(amountPaise) || amountPaise <= 0 || !idempotencyKey) {
          throw new BadRequestError('paymentOrderId, positive integer amountPaise, and idempotencyKey are required');
     }

     const responseKey = `refund:${idempotencyKey}`;
     return withIdempotency(responseKey, async () => prisma.$transaction(async (tx) => {
          // Serialize all refund reservations for this payment. Keeping the lock
          // through the gateway call prevents distinct idempotency keys from
          // both observing the same refundable balance. The gateway also gets
          // the stable key, so a retry after a process/DB failure is idempotent.
          await tx.$queryRaw`SELECT "id" FROM "payment_orders" WHERE "id" = ${paymentOrderId} FOR UPDATE`;
          const paymentOrder = await tx.paymentOrder.findUnique({ where: { id: paymentOrderId }, include: { refunds: true } });
          if (!paymentOrder) throw new NotFoundError('Payment order not found');

          const prior = await tx.refund.findUnique({ where: { idempotencyKey } });
          if (prior?.gatewayRefundId) {
               return { refundId: prior.id, paymentOrderId, status: prior.status, amountRupees: prior.amountPaise / 100, amountPaise: prior.amountPaise, gatewayRefundId: prior.gatewayRefundId };
          }
          if (paymentOrder.status !== 'CAPTURED' && paymentOrder.status !== 'PARTIALLY_REFUNDED') {
               throw new ConflictError(`Cannot refund payment in ${paymentOrder.status} status`);
          }
          if (!paymentOrder.gatewayPaymentId) throw new ConflictError('Payment has no gateway payment ID — cannot refund');

          if (prior && prior.amountPaise !== amountPaise) throw new ConflictError('Idempotency key was already used for a different refund amount');
          const totalRefunded = paymentOrder.refunds
               .filter((r) => r.status !== 'FAILED' && r.id !== prior?.id)
               .reduce((sum, r) => sum + r.amountPaise, 0);
          const refundable = paymentOrder.amountPaise - totalRefunded;
          if (amountPaise > refundable) {
               throw new BadRequestError(`Refund amount (${amountPaise}) exceeds refundable amount (${refundable}) paise`);
          }

          const gatewayResult = await getGateway().initiateRefund(
               paymentOrder.gatewayPaymentId,
               amountPaise,
               { reason, orderId: paymentOrder.orderId, idempotencyKey }
          );
          const refund = prior
               ? await tx.refund.update({ where: { id: prior.id }, data: { status: 'INITIATED', failureReason: null, gatewayRefundId: gatewayResult.gatewayRefundId } })
               : await tx.refund.create({ data: { paymentOrderId, amountPaise, reason: reason || null, status: 'INITIATED', idempotencyKey, gatewayRefundId: gatewayResult.gatewayRefundId } });

          await tx.paymentOrder.update({ where: { id: paymentOrder.id }, data: { status: 'REFUND_INITIATED', version: { increment: 1 } } });
          await tx.paymentAuditLog.create({ data: {
               paymentOrderId: paymentOrder.id,
               action: 'REFUND_INITIATED',
               gatewayResponse: gatewayResult.rawResponse,
               metadata: { refundId: refund.id, amountPaise, reason },
          } });
          console.log(`Refund initiated: ${refund.id}`, { paymentOrderId, amountPaise, gatewayRefundId: gatewayResult.gatewayRefundId });
          return { refundId: refund.id, paymentOrderId, status: refund.status, amountRupees: amountPaise / 100, amountPaise, gatewayRefundId: gatewayResult.gatewayRefundId };
     }, { maxWait: 10000, timeout: 30000 }));
};

// ─── Get Payment Order ───────────────────────────────────────────────────────

const getPaymentOrder = async (paymentOrderId) => {
     const paymentOrder = await prisma.paymentOrder.findUnique({
          where: { id: paymentOrderId },
          include: {
               auditLogs: { orderBy: { createdAt: 'desc' } },
               refunds: { orderBy: { createdAt: 'desc' } },
          },
     });

     if (!paymentOrder) {
          throw new NotFoundError('Payment order not found');
     }

     return {
          ...paymentOrder,
          amount: paymentOrder.amountPaise / 100,
          refunds: paymentOrder.refunds.map((refund) => ({ ...refund, amount: refund.amountPaise / 100 })),
     };
};

const cancelPaymentOrder = async (paymentOrderId) => {
     const updated = await prisma.paymentOrder.updateMany({ where: { id: paymentOrderId, status: 'CREATED' }, data: { status: 'CANCELLED', failureReason: 'order_cancelled', version: { increment: 1 } } });
     const paymentOrder = await prisma.paymentOrder.findUnique({ where: { id: paymentOrderId } });
     if (!paymentOrder) throw new NotFoundError('Payment order not found');
     return { paymentOrderId, status: paymentOrder.status, cancelled: Boolean(updated.count) };
};

const reconcileUnconfirmedPayments = async (limit = 50) => {
     const pending = await prisma.paymentOrder.findMany({
          where: {
               status: { in: ['CREATED', 'CANCELLED'] },
               gatewayOrderId: { not: null },
               createdAt: { lt: new Date(Date.now() - 30000) },
               OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lt: new Date(Date.now() - 5 * 60 * 1000) } }],
          },
          orderBy: { createdAt: 'asc' }, take: limit,
     });
     const gateway = getGateway();
     for (const row of pending) {
          try {
               await prisma.paymentOrder.updateMany({ where: { id: row.id }, data: { lastReconciledAt: new Date() } });
               const result = await gateway.fetchOrderPayments(row.gatewayOrderId);
               const captured = result.items?.find((p) => p.status === 'captured');
               if (captured) await handlePaymentCaptured(row, captured.id, captured);
          } catch (error) {
               console.error('Payment reconciliation failed', { paymentOrderId: row.id, error: error.message });
          }
     }
     return pending.length;
};

module.exports = {
     createPaymentOrder,
     handleWebhook,
     verifyAndCapturePayment,
     initiateRefund,
     getPaymentOrder,
     cancelPaymentOrder,
     processPaymentOutbox,
     reconcileUnconfirmedPayments,
};
