ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'RESTOCKED';

CREATE TABLE "stock_ledger" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "orderId" TEXT,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_ledger_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "stock_ledger_productId_createdAt_idx" ON "stock_ledger"("productId", "createdAt");
CREATE INDEX "stock_ledger_orderId_idx" ON "stock_ledger"("orderId");
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_productId_fkey" FOREIGN KEY ("productId") REFERENCES "stocks"("productId") ON DELETE RESTRICT ON UPDATE CASCADE;
