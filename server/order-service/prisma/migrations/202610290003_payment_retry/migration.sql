CREATE TABLE "payment_retries" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentOrderId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_retries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_retries_idempotencyKey_key" ON "payment_retries"("idempotencyKey");
CREATE INDEX "payment_retries_status_nextAttemptAt_idx" ON "payment_retries"("status", "nextAttemptAt");
