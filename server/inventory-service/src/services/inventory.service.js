const prisma = require('../config/prisma');
const inventoryProducer = require('../kafka/producer/inventory.producer');
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
                    error.message?.includes('deadlock detected') || error.code === 'STALE_STOCK';
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
          const stock = await tx.stock.upsert({
               where: { productId: product.id },
               update: {},
               create: {
                    productId: product.id,
                    sku: product.sku,
                    available: product.initialStock || 0,
                    reserved: 0,
               },
          });
          const ledgerRows = await tx.stockLedger.count({ where: { productId: product.id } });
          if (!ledgerRows) await tx.stockLedger.create({ data: { productId: product.id, delta: stock.available + stock.reserved, reason: 'BASELINE' } });
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

     try {
          const result = await retryTransaction(() =>
               prisma.$transaction(async (tx) => {
                    const reservedRows = [];
                    for (const item of items) {
                         const prior = await tx.stockReservation.findUnique({ where: { orderId_productId: { orderId, productId: item.productId } } });
                         if (prior?.status === 'HELD' && prior.expiresAt > new Date()) {
                              reservedRows.push(prior);
                              continue;
                         }
                         if (prior && !['RELEASED', 'EXPIRED'].includes(prior.status)) throw new ConflictError(`Reservation is already ${prior.status} for ${item.productId}`, 'INVALID_RESERVATION_TRANSITION');
                         const updated = await tx.stock.updateMany({
                              where: { productId: item.productId, available: { gte: item.quantity } },
                              data: {
                                   available: { decrement: item.quantity },
                                   reserved: { increment: item.quantity },
                                   version: { increment: 1 },
                              },
                         });
                         if (updated.count === 0) throw new ConflictError(`Insufficient or concurrently changed stock for product ${item.productId}`, 'INSUFFICIENT_STOCK');

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
                         await tx.stockLedger.create({ data: { productId: item.productId, orderId, delta: 0, reason: 'RESERVED' } });
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
                    if (reservation?.status === 'CONFIRMED') continue;
                    if (!reservation) throw new ConflictError(`Reservation for ${item.productId} is missing`, 'RESERVATION_UNAVAILABLE');
                    if (['RELEASED', 'EXPIRED'].includes(reservation.status)) {
                         const reclaimed = await tx.stock.updateMany({ where: { productId: item.productId, available: { gte: reservation.quantity } }, data: { available: { decrement: reservation.quantity }, reserved: { increment: reservation.quantity }, version: { increment: 1 } } });
                         if (!reclaimed.count) throw new ConflictError(`Reservation expired and stock is no longer available for ${item.productId}`, 'RESERVATION_EXPIRED');
                         const reopened = await tx.stockReservation.updateMany({ where: { id: reservation.id, status: reservation.status }, data: { status: 'HELD', expiresAt: new Date(Date.now() + config.LOCK_TTL_SECONDS * 1000) } });
                         if (!reopened.count) throw new ConflictError(`Reservation changed concurrently for ${item.productId}`, 'RESERVATION_UNAVAILABLE');
                         await tx.stockLedger.create({ data: { productId: item.productId, orderId, delta: 0, reason: 'RE_RESERVED_FOR_CAPTURE' } });
                    } else if (reservation.status !== 'HELD') {
                         throw new ConflictError(`Reservation for ${item.productId} is ${reservation.status}`, 'RESERVATION_UNAVAILABLE');
                    }
                    // If the TTL elapsed but the sweeper has not released this HELD row,
                    // its stock is still reserved and can be confirmed safely. If the
                    // sweeper won, the status changed and the reclaim branch above runs.
                    const changed = await tx.stockReservation.updateMany({ where: { id: reservation.id, status: 'HELD' }, data: { status: 'CONFIRMED' } });
                    if (!changed.count) throw new ConflictError(`Reservation changed before confirmation for ${item.productId}`, 'RESERVATION_UNAVAILABLE');
                    const stockChange = await tx.stock.updateMany({ where: { productId: item.productId, reserved: { gte: reservation.quantity } }, data: { reserved: { decrement: reservation.quantity }, version: { increment: 1 } } });
                    if (!stockChange.count) throw new ConflictError(`Reserved stock is inconsistent for ${item.productId}`, 'STOCK_INVARIANT');
                    await tx.stockLedger.create({ data: { productId: item.productId, orderId, delta: -reservation.quantity, reason: 'CONFIRMED' } });
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

const releaseStock = async (orderId, items, expiresBefore = null) => {
     await retryTransaction(() =>
          prisma.$transaction(async (tx) => {
               for (const item of items) {
                    const reservation = await tx.stockReservation.findUnique({
                         where: { orderId_productId: { orderId, productId: item.productId } },
                    });
                    if (!reservation || reservation.status === 'RELEASED' || reservation.status === 'EXPIRED') continue;
                    if (reservation.status !== 'HELD') throw new ConflictError(`Cannot release reservation in ${reservation.status} state; use restockConfirmedStock`, 'INVALID_RESERVATION_TRANSITION');
                    const reservationWhere = { id: reservation.id, status: 'HELD' };
                    if (expiresBefore) reservationWhere.expiresAt = { lte: expiresBefore };
                    const changed = await tx.stockReservation.updateMany({ where: reservationWhere, data: { status: 'RELEASED' } });
                    if (!changed.count) continue;
                    await tx.stock.update({ where: { productId: item.productId }, data: { available: { increment: reservation.quantity }, reserved: { decrement: reservation.quantity }, version: { increment: 1 } } });
                    await tx.stockLedger.create({ data: { productId: item.productId, orderId, delta: 0, reason: 'RELEASED' } });
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

const extendReservation = async (orderId, ttlSeconds) => {
     const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
     const updated = await prisma.stockReservation.updateMany({
          where: { orderId, status: 'HELD' },
          data: { expiresAt },
     });
     if (!updated.count) throw new ConflictError(`No held reservation to extend for order ${orderId}`, 'RESERVATION_UNAVAILABLE');
     return { orderId, expiresAt };
};

const restockConfirmedStock = async (orderId, items) => {
     await prisma.$transaction(async (tx) => {
          for (const item of items) {
               const reservation = await tx.stockReservation.findUnique({ where: { orderId_productId: { orderId, productId: item.productId } } });
               if (reservation?.status === 'RESTOCKED') continue;
               if (!reservation || reservation.status !== 'CONFIRMED') throw new ConflictError(`Cannot restock reservation in ${reservation?.status || 'missing'} state`, 'INVALID_RESERVATION_TRANSITION');
               const changed = await tx.stockReservation.updateMany({ where: { id: reservation.id, status: 'CONFIRMED' }, data: { status: 'RESTOCKED' } });
               if (!changed.count) continue;
               await tx.stock.update({ where: { productId: item.productId }, data: { available: { increment: reservation.quantity }, version: { increment: 1 } } });
               await tx.stockLedger.create({ data: { productId: item.productId, orderId, delta: reservation.quantity, reason: 'RESTOCKED' } });
          }
     });
     return { orderId, status: 'RESTOCKED' };
};

// ─── Admin: restock / adjust ─────────────────────────────────────────────────

const adjustStock = async (productId, sku, delta) => {
     const stock = await prisma.$transaction(async (tx) => {
          const current = await tx.stock.findUnique({ where: { productId } });
          let updated;
          let appliedDelta = delta;
          if (current) {
               if (current.available + delta < 0) throw new ConflictError('Adjustment cannot reduce available stock below zero', 'INVALID_STOCK_ADJUSTMENT');
               updated = await tx.stock.update({ where: { productId }, data: { available: { increment: delta }, version: { increment: 1 } } });
          } else {
               appliedDelta = Math.max(delta, 0);
               updated = await tx.stock.create({ data: { productId, sku, available: appliedDelta, reserved: 0 } });
          }
          await tx.stockLedger.create({ data: { productId, delta: appliedDelta, reason: 'ADMIN_ADJUSTMENT' } });
          return updated;
     });
     await inventoryProducer.publishStockUpdated(stock).catch(() => {});
     return stock;
};

const reconcileStockLedger = async () => {
     const stocks = await prisma.stock.findMany({ select: { productId: true, available: true, reserved: true } });
     const aggregates = await prisma.stockLedger.groupBy({ by: ['productId'], _sum: { delta: true } });
     const ledgerByProduct = new Map(aggregates.map((row) => [row.productId, row._sum.delta || 0]));
     const mismatches = [];
     for (const stock of stocks) {
          const ledgerTotal = ledgerByProduct.get(stock.productId) || 0;
          if (ledgerTotal !== stock.available + stock.reserved) {
               const mismatch = { productId: stock.productId, stockTotal: stock.available + stock.reserved, ledgerTotal };
               mismatches.push(mismatch);
               const activeAlert = await prisma.stockLedgerAlert.findFirst({ where: { productId: stock.productId, resolvedAt: null } });
               if (activeAlert) await prisma.stockLedgerAlert.update({ where: { id: activeAlert.id }, data: { expectedTotal: mismatch.stockTotal, actualTotal: mismatch.ledgerTotal, lastDetectedAt: new Date() } });
               else await prisma.stockLedgerAlert.create({ data: { productId: stock.productId, expectedTotal: mismatch.stockTotal, actualTotal: mismatch.ledgerTotal } });
          } else {
               await prisma.stockLedgerAlert.updateMany({ where: { productId: stock.productId, resolvedAt: null }, data: { resolvedAt: new Date() } });
          }
     }
     if (mismatches.length) console.error('ALERT: inventory ledger reconciliation mismatch', { count: mismatches.length, mismatches });
     return { checked: stocks.length, mismatches };
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
               // The expiry predicate is part of the state transition itself. If
               // checkout extended a hold after the sweep query, this update loses.
               await releaseStock(orderId, items, new Date());
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
     extendReservation,
     restockConfirmedStock,
     adjustStock,
     sweepExpiredReservations,
     reconcileStockLedger,
};
