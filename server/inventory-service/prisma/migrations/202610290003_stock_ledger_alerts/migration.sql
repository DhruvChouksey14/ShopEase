CREATE TABLE "stock_ledger_alerts" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "expectedTotal" INTEGER NOT NULL,
    "actualTotal" INTEGER NOT NULL,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "stock_ledger_alerts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "stock_ledger_alerts_productId_resolvedAt_idx" ON "stock_ledger_alerts"("productId", "resolvedAt");
ALTER TABLE "stock_ledger_alerts" ADD CONSTRAINT "stock_ledger_alerts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "stocks"("productId") ON DELETE RESTRICT ON UPDATE CASCADE;
