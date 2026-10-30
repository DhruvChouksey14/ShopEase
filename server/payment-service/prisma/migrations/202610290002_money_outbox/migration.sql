ALTER TABLE "payment_orders" ADD COLUMN "amountPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "payment_orders" ADD COLUMN "lastReconciledAt" TIMESTAMP(3);
ALTER TABLE "refunds" ADD COLUMN "amountPaise" INTEGER NOT NULL DEFAULT 0;
UPDATE "payment_orders" SET "amountPaise" = ROUND("amount" * 100)::INTEGER;
UPDATE "refunds" SET "amountPaise" = ROUND("amount" * 100)::INTEGER;
CREATE TABLE "payment_outbox" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_outbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_outbox_eventKey_key" ON "payment_outbox"("eventKey");
CREATE INDEX "payment_outbox_status_nextAttemptAt_idx" ON "payment_outbox"("status", "nextAttemptAt");
