const axios = require('axios');
const prisma = require('../config/prisma');
const { config } = require('../config');
const { inventoryClient } = require('./inventoryClient');
const { paymentClient } = require('./paymentClient');
const { userClient } = require('./userClient');
const { cartClient } = require('./cartClient');
const saga = require('./saga.service');
const orderProducer = require('../kafka/producer/order.producer');
const { publishToQueue } = require('../../../../shared/rabbitmq/rabbitmq');
const { emitOrderStatus } = require('../sockets/io');
const { BadRequestError, NotFoundError, ConflictError, StaleStateError } = require('../utils/error');

const catalogClient = axios.create({
     baseURL: config.CATALOG_SERVICE_URL,
     timeout: 8000,
     headers: { 'Content-Type': 'application/json', 'x-internal-service-key': config.INTERNAL_SERVICE_KEY },
});

// ─── Optimistic Lock Helper (CAS — Compare-And-Swap) ────────────────────────

const casUpdateOrder = async (orderId, expectedVersion, data) => {
     const result = await prisma.order.updateMany({
          where: { id: orderId, version: expectedVersion },
          data: { ...data, version: { increment: 1 } },
     });
     if (result.count === 0) {
          throw new StaleStateError(`Order ${orderId} was modified by another process (expected version ${expectedVersion})`);
     }
};

const notifyStatus = async (order, status, extra = {}) => {
     emitOrderStatus(order.userId, { orderId: order.id, status, ...extra });
};

const fetchUserForNotification = async (userId) => {
     try {
          const user = await userClient.getUserById(userId);
          return user ? { email: user.email, firstName: user.firstName } : {};
     } catch (err) {
          console.warn('Failed to enrich order event with user details', { userId, error: err.message });
          return {};
     }
};

// ─── Idempotency ──────────────────────────────────────────────────────────────

const checkIdempotency = async (key) => {
     const existing = await prisma.idempotencyRecord.findUnique({ where: { eventKey: key } });
     if (existing) {
          console.log(`Idempotent request: ${key}`);
          return existing.response;
     }
     return null;
};

const saveIdempotency = async (key, response) => {
     await prisma.idempotencyRecord.create({ data: { eventKey: key, response } });
};

// ─── Create Order (checkout) ──────────────────────────────────────────────────
// Cart items only carry {productId, quantity} — price/name/sku/image are always
// re-fetched from catalog-service at checkout time so a stale cart never locks
// in an out-of-date price.

const createOrder = async (userId, shippingAddress, idempotencyKey) => {
     if (!idempotencyKey) throw new BadRequestError('idempotencyKey is required');
     if (!shippingAddress || !shippingAddress.line1 || !shippingAddress.city || !shippingAddress.postalCode) {
          throw new BadRequestError('A complete shippingAddress (line1, city, postalCode, country) is required');
     }

     const cached = await checkIdempotency(`order:${idempotencyKey}`);
     if (cached) return cached;

     const cart = await cartClient.getCart(userId);
     if (!cart || !cart.items || cart.items.length === 0) {
          throw new BadRequestError('Cart is empty');
     }

     const productIds = cart.items.map((i) => i.productId);
     const { data: products } = await catalogClient.post('/products/bulk', { ids: productIds });
     const productMap = new Map(products.map((p) => [p.id, p]));

     const orderItems = [];
     let totalAmount = 0;
     for (const item of cart.items) {
          const product = productMap.get(item.productId);
          if (!product || !product.isActive) {
               throw new NotFoundError(`Product ${item.productId} is no longer available`);
          }
          orderItems.push({
               productId: product.id,
               sku: product.sku,
               name: product.name,
               price: product.price,
               quantity: item.quantity,
               imageUrl: product.images?.[0] || null,
          });
          totalAmount += product.price * item.quantity;
     }

     let order;
     try {
          const lockExpiresAt = new Date(Date.now() + config.ORDER_TTL_SECONDS * 1000);
          order = await prisma.order.create({
               data: {
                    userId,
                    status: 'PENDING',
                    totalAmount,
                    idempotencyKey,
                    lockExpiresAt,
                    shippingAddress,
                    items: { create: orderItems },
               },
               include: { items: true },
          });

          const stockItems = orderItems.map((i) => ({ productId: i.productId, quantity: i.quantity }));

          // Saga Step 1: reserve stock
          await saga.executeReserveStock(order, stockItems);
          await notifyStatus(order, 'STOCK_RESERVED');

          // Saga Step 2: create payment order (Razorpay)
          const paymentOrder = await saga.executeCreatePayment(order);
          await notifyStatus(order, 'PAYMENT_PENDING');

          order = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true } });

          // Cart is only cleared once checkout has successfully reached PAYMENT_PENDING —
          // if the saga fails before this point the user still has their cart to retry with.
          await cartClient.clearCart(userId).catch((err) =>
               console.warn('Failed to clear cart after checkout', { userId, error: err.message })
          );

          const response = {
               orderId: order.id,
               status: order.status,
               totalAmount: order.totalAmount,
               lockExpiresAt: order.lockExpiresAt,
               items: order.items.map((i) => ({ productId: i.productId, name: i.name, price: i.price, quantity: i.quantity, imageUrl: i.imageUrl })),
               paymentOrder: {
                    paymentOrderId: paymentOrder.paymentOrderId,
                    gatewayOrderId: paymentOrder.gatewayOrderId,
                    amount: paymentOrder.amount,
                    currency: paymentOrder.currency,
                    keyId: paymentOrder.keyId,
               },
          };

          await saveIdempotency(`order:${idempotencyKey}`, response);
          return response;
     } catch (error) {
          console.error(`Order creation failed for user ${userId}`, { error: error.message });

          if (order) {
               const stockItems = orderItems.map((i) => ({ productId: i.productId, quantity: i.quantity }));
               await saga.compensateAll(order, stockItems);
               await prisma.order.update({
                    where: { id: order.id },
                    data: { status: 'FAILED', failureReason: error.response?.data?.message || error.message },
               });
               await notifyStatus(order, 'FAILED');
          }
          throw error;
     }
};

// ─── Handle Payment Success (Kafka consumer) ─────────────────────────────────

const handlePaymentSuccess = async (paymentOrderId) => {
     const order = await prisma.order.findUnique({ where: { paymentOrderId }, include: { items: true } });
     if (!order) {
          console.warn(`No order found for paymentOrderId: ${paymentOrderId}`);
          return;
     }
     if (order.status === 'CONFIRMED') {
          console.log(`Order ${order.id} already confirmed`);
          return;
     }
     if (order.status !== 'PAYMENT_PENDING') {
          console.warn(`Order ${order.id} in unexpected status: ${order.status}`);
          return;
     }

     const stockItems = order.items.map((i) => ({ productId: i.productId, quantity: i.quantity }));

     try {
          await casUpdateOrder(order.id, order.version, { status: 'CONFIRMING' });

          // Saga Step 3: permanently confirm the stock deduction
          await saga.executeConfirmStock(order, stockItems);

          await prisma.order.updateMany({ where: { id: order.id, status: 'CONFIRMING' }, data: { status: 'CONFIRMED', version: { increment: 1 } } });
          await notifyStatus(order, 'CONFIRMED');

          try {
               const userInfo = await fetchUserForNotification(order.userId);
               await orderProducer.publishOrderConfirmed({
                    orderId: order.id,
                    userId: order.userId,
                    email: userInfo.email,
                    firstName: userInfo.firstName,
                    items: order.items.map((i) => ({ name: i.name, price: i.price, quantity: i.quantity })),
                    totalAmount: order.totalAmount,
                    shippingAddress: order.shippingAddress,
               });
          } catch (err) {
               console.error('CRITICAL: Failed to publish ORDER_CONFIRMED after retries', { orderId: order.id, error: err.message });
          }

          // Background job (RabbitMQ, with retry + DLQ): generate & email the PDF invoice.
          // Decoupled from the critical path — invoice delivery failing should never
          // undo an already-confirmed, already-paid order.
          try {
               await publishToQueue('orders.invoice', {
                    orderId: order.id,
                    userId: order.userId,
                    items: order.items.map((i) => ({ name: i.name, price: i.price, quantity: i.quantity })),
                    totalAmount: order.totalAmount,
                    shippingAddress: order.shippingAddress,
                    confirmedAt: new Date().toISOString(),
               });
          } catch (err) {
               console.error('Failed to enqueue invoice generation job', { orderId: order.id, error: err.message });
          }

          console.log(`Order ${order.id} confirmed successfully`);
     } catch (error) {
          if (error.code === 'STALE_STATE') {
               console.log(`Order ${order.id} already handled by another process, skipping`);
               return;
          }

          console.error(`Failed to confirm order ${order.id}`, { error: error.message });

          await saga.compensateAll(order, stockItems);
          await prisma.order.updateMany({
               where: { id: order.id, status: { in: ['PAYMENT_PENDING', 'CONFIRMING'] } },
               data: { status: 'FAILED', failureReason: `confirm_failed: ${error.message}`, version: { increment: 1 } },
          });
          await notifyStatus(order, 'FAILED');

          try {
               const userInfo = await fetchUserForNotification(order.userId);
               await orderProducer.publishOrderFailed({ orderId: order.id, userId: order.userId, email: userInfo.email, firstName: userInfo.firstName, reason: 'confirm_stock_failed' });
          } catch (err) {
               console.error('Failed to publish ORDER_FAILED after retries', { orderId: order.id, error: err.message });
          }
     }
};

// ─── Handle Payment Failure (Kafka consumer) ─────────────────────────────────

const handlePaymentFailure = async (paymentOrderId, reason) => {
     const order = await prisma.order.findUnique({ where: { paymentOrderId }, include: { items: true } });
     if (!order) {
          console.warn(`No order found for paymentOrderId: ${paymentOrderId}`);
          return;
     }
     if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(order.status)) {
          console.log(`Order ${order.id} already in terminal state: ${order.status}`);
          return;
     }
     if (order.status !== 'PAYMENT_PENDING') {
          console.warn(`Order ${order.id} in unexpected status: ${order.status}`);
          return;
     }

     try {
          await casUpdateOrder(order.id, order.version, { status: 'FAILED', failureReason: reason || 'payment_failed' });
     } catch (error) {
          if (error.code === 'STALE_STATE') return;
          throw error;
     }

     const stockItems = order.items.map((i) => ({ productId: i.productId, quantity: i.quantity }));
     await saga.compensateReserveStock(order, stockItems);
     await notifyStatus(order, 'FAILED');

     try {
          const userInfo = await fetchUserForNotification(order.userId);
          await orderProducer.publishOrderFailed({ orderId: order.id, userId: order.userId, email: userInfo.email, firstName: userInfo.firstName, reason: reason || 'payment_failed' });
     } catch (err) {
          console.error('Failed to publish ORDER_FAILED after retries', { orderId: order.id, error: err.message });
     }

     console.log(`Order ${order.id} failed: ${reason}`);
};

// ─── Cancel Order ──────────────────────────────────────────────────────────

const cancelOrder = async (orderId, userId) => {
     const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
     if (!order || order.userId !== userId) throw new NotFoundError('Order not found');

     if (['CANCELLED', 'CANCELLING', 'FAILED', 'EXPIRED', 'CONFIRMING', 'SHIPPED', 'DELIVERED'].includes(order.status)) {
          throw new ConflictError(`Order is already ${order.status}`);
     }

     const stockItems = order.items.map((i) => ({ productId: i.productId, quantity: i.quantity }));
     let refundInitiated = false;

     try {
          await casUpdateOrder(order.id, order.version, { status: 'CANCELLING', failureReason: 'user_cancelled' });
     } catch (error) {
          if (error.code === 'STALE_STATE') {
               const fresh = await prisma.order.findUnique({ where: { id: orderId } });
               throw new ConflictError(`Order status changed to ${fresh?.status || 'unknown'} while cancelling. Please refresh.`);
          }
          throw error;
     }

     if (order.status === 'CONFIRMED') {
          try {
               await inventoryClient.releaseStock(order.id, stockItems);
          } catch (error) {
               console.error(`Failed to release stock for order ${order.id}`, { error: error.message });
               await prisma.order.updateMany({ where: { id: order.id, status: 'CANCELLING' }, data: { status: 'CONFIRMED', failureReason: null, version: { increment: 1 } } });
               throw error;
          }

          if (order.paymentOrderId) {
               try {
                    await paymentClient.initiateRefund(order.paymentOrderId, order.totalAmount, 'user_cancelled', `${order.id}-cancel-refund`);
                    refundInitiated = true;
               } catch (error) {
                    console.error(`Failed to initiate refund for order ${order.id}`, { error: error.message });
               }
          }
     } else if (['STOCK_RESERVED', 'PAYMENT_PENDING'].includes(order.status)) {
          try {
               await inventoryClient.releaseStock(order.id, stockItems);
          } catch (error) {
               console.error('Failed to release stock during cancel', { error: error.message });
          }
     }

     await prisma.order.updateMany({ where: { id: order.id, status: 'CANCELLING' }, data: { status: 'CANCELLED', version: { increment: 1 } } });
     await notifyStatus(order, 'CANCELLED');

     try {
          const userInfo = await fetchUserForNotification(order.userId);
          await orderProducer.publishOrderCancelled({ orderId: order.id, userId: order.userId, email: userInfo.email, firstName: userInfo.firstName, reason: 'user_cancelled', refundAmount: refundInitiated ? order.totalAmount : 0 });
     } catch (err) {
          console.error('Failed to publish ORDER_CANCELLED after retries', { orderId: order.id, error: err.message });
     }

     return { orderId: order.id, status: 'CANCELLED', refundInitiated };
};

// ─── Admin: mark shipped ─────────────────────────────────────────────────────

const markShipped = async (orderId, trackingNumber) => {
     const order = await prisma.order.findUnique({ where: { id: orderId } });
     if (!order) throw new NotFoundError('Order not found');
     if (order.status !== 'CONFIRMED') throw new ConflictError('Only confirmed orders can be marked as shipped');

     const updated = await prisma.order.update({ where: { id: orderId }, data: { status: 'SHIPPED', version: { increment: 1 } } });
     await notifyStatus(updated, 'SHIPPED', { trackingNumber });

     try {
          const userInfo = await fetchUserForNotification(order.userId);
          await orderProducer.publishOrderShipped({ orderId: order.id, userId: order.userId, email: userInfo.email, firstName: userInfo.firstName, trackingNumber });
     } catch (err) {
          console.error('Failed to publish ORDER_SHIPPED after retries', { orderId, error: err.message });
     }
     return updated;
};

// ─── Reads ────────────────────────────────────────────────────────────────

const getOrder = async (orderId, userId, isAdmin = false) => {
     const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
     if (!order || (!isAdmin && order.userId !== userId)) throw new NotFoundError('Order not found');
     return order;
};

const getUserOrders = async (userId, { status, page = 1, limit = 10 } = {}) => {
     const skip = (page - 1) * limit;
     const where = { userId };
     if (status) where.status = status.toUpperCase();

     const [orders, total] = await Promise.all([
          prisma.order.findMany({ where, include: { items: true }, orderBy: { createdAt: 'desc' }, skip, take: limit }),
          prisma.order.count({ where }),
     ]);

     return { orders, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

const getAllOrders = async ({ status, page = 1, limit = 20 } = {}) => {
     const skip = (page - 1) * limit;
     const where = {};
     if (status) where.status = status.toUpperCase();

     const [orders, total] = await Promise.all([
          prisma.order.findMany({ where, include: { items: true }, orderBy: { createdAt: 'desc' }, skip, take: limit }),
          prisma.order.count({ where }),
     ]);

     return { orders, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

// ─── Verify Payment (client-side confirmation right after Razorpay checkout) ─

const verifyPayment = async (orderId, userId, razorpayPaymentId, razorpaySignature) => {
     const order = await prisma.order.findUnique({ where: { id: orderId } });
     if (!order || order.userId !== userId) throw new NotFoundError('Order not found');
     if (!order.paymentOrderId) throw new BadRequestError('Order has no payment order');
     if (order.status === 'CONFIRMED') return { orderId: order.id, status: 'CONFIRMED', message: 'Already confirmed' };
     if (order.status !== 'PAYMENT_PENDING') throw new ConflictError(`Order is in ${order.status} status, cannot verify payment`);

     const result = await paymentClient.verifyPayment(order.paymentOrderId, razorpayPaymentId, razorpaySignature);
     console.log(`Payment verified for order ${orderId}`, { result });
     return { orderId: order.id, paymentStatus: result.status };
};

// ─── Expiry sweep — orders whose checkout window lapsed without payment ─────

const sweepExpiredOrders = async () => {
     const expired = await prisma.order.findMany({
          where: { status: { in: ['PENDING', 'STOCK_RESERVED', 'PAYMENT_PENDING'] }, lockExpiresAt: { lt: new Date() } },
          include: { items: true },
     });

     for (const order of expired) {
          try {
               await casUpdateOrder(order.id, order.version, { status: 'EXPIRED', failureReason: 'checkout_window_expired' });
               const stockItems = order.items.map((i) => ({ productId: i.productId, quantity: i.quantity }));
               await saga.compensateReserveStock(order, stockItems);
               await notifyStatus(order, 'EXPIRED');
               console.log(`Order ${order.id} expired and stock released`);
          } catch (err) {
               if (err.code !== 'STALE_STATE') console.error(`Failed to expire order ${order.id}`, { error: err.message });
          }
     }
     return { swept: expired.length };
};

module.exports = {
     createOrder,
     handlePaymentSuccess,
     handlePaymentFailure,
     cancelOrder,
     markShipped,
     getOrder,
     getUserOrders,
     getAllOrders,
     verifyPayment,
     sweepExpiredOrders,
};
