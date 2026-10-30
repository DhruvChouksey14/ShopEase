CREATE TABLE "order_outbox" (
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
    CONSTRAINT "order_outbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "order_outbox_eventKey_key" ON "order_outbox"("eventKey");
CREATE INDEX "order_outbox_status_nextAttemptAt_idx" ON "order_outbox"("status", "nextAttemptAt");
