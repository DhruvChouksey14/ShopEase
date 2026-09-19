const prisma = require('../config/prisma');
const inventoryProducer = require('../kafka/producer/inventory.producer');
const { acquireProductLocks, releaseProductLocks } = require('../utils/distributedLock');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/error');
const { config } = require('../config');

async function retryTransaction(fn, maxRetries = 3) {
     for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
               return await fn();
          } catch (error) {
               const isRetryable =
                    error.code === 'P2034' ||
                    error.message?.includes('could not serialize') ||
                    error.message?.includes('deadlock detected');
               if (isRetryable && attempt < maxRetries) {
                    console.warn(`Transaction attempt ${attempt} failed (retryable), retrying...`);
                    await new Promise((r) => setTimeout(r, 50 * attempt));
                    continue;
               }
               throw error;
          }
     }
}

// ─── Kafka Event Handler: seed a stock row when a product is created ────────

const initializeStock = async (product) => {
     const eventKey = `PRODUCT_CREATED:${product.id}`;
     const existing = await prisma.idempotencyRecord.findUnique({ where: { eventKey } });
     if (existing) {
          console.log(`Duplicate event skipped: ${eventKey}`);
          return;
     }

     await prisma.$transaction(async (tx) => {
          await tx.stock.upsert({
               where: { productId: product.id },
               update: {},
               create: {
                    productId: product.id,
                    sku: product.sku,
                    available: product.initialStock || 0,
                    reserved: 0,
               },
          });
          await tx.idempotencyRecord.create({ data: { eventKey } });
     });

     console.log(`Stock initialized for product ${product.id}`, { initial: product.initialStock || 0 });
};

// ─── Public read APIs ────────────────────────────────────────────────────────

const getStock = async (productId) => {
     const stock = await prisma.stock.findUnique({ where: { productId } });
     if (!stock) throw new NotFoundError('No stock record for this product');
     return {
          productId: stock.productId,
          available: stock.available,
          reserved: stock.reserved,
          inStock: stock.available > 0,
          lowStock: stock.available > 0 && stock.available <= stock.lowStockThreshold,
     };
};

const getBulkStock = async (productIds) => {
     const stocks = await prisma.stock.findMany({ where: { productId: { in: productIds } } });
     const map = new Map(stocks.map((s) => [s.productId, s]));
     return productIds.map((id) => {
          const s = map.get(id);
          return s
               ? { productId: id, available: s.available, reserved: s.reserved, inStock: s.available > 0 }
               : { productId: id, available: 0, reserved: 0, inStock: false };
     });
};

// ─── Reserve stock (checkout step 1 of the saga) ─────────────────────────────
// items: [{ productId, quantity }]

const reserveStock = async (orderId, items, ttlSeconds = config.LOCK_TTL_SECONDS) => {
     if (!orderId || !items || !items.length) {
          throw new BadRequestError('orderId and items (non-empty array) are required');
     }

     const productIds = items.map((i) => i.productId);
     const { acquired, lockValue } = await acquireProductLocks(productIds, `order-${orderId}`, ttlSeconds);
     if (!acquired) {
          throw new ConflictError('One or more products are being purchased by another order right now. Please retry.', 'PRODUCT_LOCKED');
     }

     try {
          const result = await retryTransaction(() =>
               prisma.$transaction(async (tx) => {
                    const reservedRows = [];
                    for (const item of items) {
                         const stock = await tx.stock.findUnique({ where: { productId: item.productId } });
                         if (!stock) throw new NotFoundError(`No stock record for product ${item.productId}`);
                         if (stock.available < item.quantity) {
                              throw new ConflictError(`Insufficient stock for product ${item.productId}`, 'INSUFFICIENT_STOCK');
                         }

                         const updated = await tx.stock.updateMany({
                              where: { productId: item.productId, version: stock.version },
                              data: {
                                   available: { decrement: item.quantity },
                                   reserved: { increment: item.quantity },
                                   version: { increment: 1 },
                              },
                         });
                         if (updated.count === 0) {
                              throw new ConflictError(`Stock for product ${item.productId} changed concurrently, please retry`, 'STALE_STOCK');
                         }

                         const reservation = await tx.stockReservation.upsert({
                              where: { orderId_productId: { orderId, productId: item.productId } },
                              update: {
                                   quantity: item.quantity,
                                   status: 'HELD',
                                   expiresAt: new Date(Date.now() + ttlSeconds * 1000),
                              },
                              create: {
                                   orderId,
                                   productId: item.productId,
                                   quantity: item.quantity,
                                   status: 'HELD',
                                   expiresAt: new Date(Date.now() + ttlSeconds * 1000),
                              },
                         });
                         reservedRows.push(reservation);
                    }
                    return reservedRows;
               })
          );

          // Fire-and-log availability events (best-effort — never blocks checkout)
          for (const item of items) {
               getStock(item.productId)
                    .then((s) => inventoryProducer.publishStockUpdated(s))
                    .catch((e) => console.warn('Failed to publish stock update', e.message));
          }

          return {
               orderId,
               reservedItems: result.map((r) => ({ productId: r.productId, quantity: r.quantity })),
               expiresAt: result[0]?.expiresAt,
          };
     } catch (error) {
          // Roll back any partial reservation for this order and rethrow
          await releaseStock(orderId, items).catch(() => {});
          throw error;
     } finally {
          await releaseProductLocks(productIds, lockValue);
     }
};

// ─── Confirm stock (checkout step 3 — payment succeeded, stock permanently leaves) ─

const confirmStock = async (orderId, items) => {
     await retryTransaction(() =>
          prisma.$transaction(async (tx) => {
               for (const item of items) {
                    const reservation = await tx.stockReservation.findUnique({
                         where: { orderId_productId: { orderId, productId: item.productId } },
                    });
                    if (!reservation || reservation.status !== 'HELD') {
                         console.warn(`No active reservation to confirm for order ${orderId}, product ${item.productId} — treating as already handled`);
                         continue;
                    }

                    await tx.stock.update({
                         where: { productId: item.productId },
                         data: { reserved: { decrement: reservation.quantity }, version: { increment: 1 } },
                    });
                    await tx.stockReservation.update({
                         where: { id: reservation.id },
                         data: { status: 'CONFIRMED' },
                    });
               }
          })
     );

     for (const item of items) {
          getStock(item.productId)
               .then((s) => inventoryProducer.publishStockUpdated(s))
               .catch(() => {});
     }

     return { orderId, status: 'CONFIRMED' };
};

// ─── Release stock (compensation — order failed/cancelled/expired) ──────────

const releaseStock = async (orderId, items) => {
     await retryTransaction(() =>
          prisma.$transaction(async (tx) => {
               for (const item of items) {
                    const reservation = await tx.stockReservation.findUnique({
                         where: { orderId_productId: { orderId, productId: item.productId } },
                    });
                    if (!reservation || reservation.status !== 'HELD') continue;

                    await tx.stock.update({
                         where: { productId: item.productId },
                         data: {
                              available: { increment: reservation.quantity },
                              reserved: { decrement: reservation.quantity },
                              version: { increment: 1 },
                         },
                    });
                    await tx.stockReservation.update({ where: { id: reservation.id }, data: { status: 'RELEASED' } });
               }
          })
     );

     for (const item of items) {
          getStock(item.productId)
               .then((s) => inventoryProducer.publishStockUpdated(s))
               .catch(() => {});
     }

     return { orderId, status: 'RELEASED' };
};

// ─── Admin: restock / adjust ─────────────────────────────────────────────────

const adjustStock = async (productId, sku, delta) => {
     const stock = await prisma.stock.upsert({
          where: { productId },
          update: { available: { increment: delta }, version: { increment: 1 } },
          create: { productId, sku, available: Math.max(delta, 0), reserved: 0 },
     });
     await inventoryProducer.publishStockUpdated(stock).catch(() => {});
     return stock;
};

// ─── Expiry sweep — reaps abandoned reservations whose order never completed ─

const sweepExpiredReservations = async () => {
     const expired = await prisma.stockReservation.findMany({
          where: { status: 'HELD', expiresAt: { lt: new Date() } },
     });

     if (expired.length === 0) return { swept: 0 };

     const byOrder = new Map();
     for (const r of expired) {
          if (!byOrder.has(r.orderId)) byOrder.set(r.orderId, []);
          byOrder.get(r.orderId).push({ productId: r.productId, quantity: r.quantity });
     }

     for (const [orderId, items] of byOrder) {
          try {
               await releaseStock(orderId, items);
               await prisma.stockReservation.updateMany({
                    where: { orderId, status: 'RELEASED', updatedAt: { gte: new Date(Date.now() - 5000) } },
                    data: { status: 'EXPIRED' },
               });
               console.log(`Swept expired reservation for order ${orderId}`);
          } catch (err) {
               console.error(`Failed to sweep reservation for order ${orderId}`, { error: err.message });
          }
     }

     return { swept: byOrder.size };
};

module.exports = {
     initializeStock,
     getStock,
     getBulkStock,
     reserveStock,
     confirmStock,
     releaseStock,
     adjustStock,
     sweepExpiredReservations,
};
