CREATE TABLE "inventory_retries" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inventory_retries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "inventory_retries_idempotencyKey_key" ON "inventory_retries"("idempotencyKey");
CREATE INDEX "inventory_retries_status_nextAttemptAt_idx" ON "inventory_retries"("status", "nextAttemptAt");
