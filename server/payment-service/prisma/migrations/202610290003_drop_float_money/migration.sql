DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "payment_orders" WHERE "amountPaise" IS DISTINCT FROM ROUND("amount" * 100)::INTEGER) THEN
    RAISE EXCEPTION 'payment amount paise backfill comparison failed';
  END IF;
  IF EXISTS (SELECT 1 FROM "refunds" WHERE "amountPaise" IS DISTINCT FROM ROUND("amount" * 100)::INTEGER) THEN
    RAISE EXCEPTION 'refund amount paise backfill comparison failed';
  END IF;
END $$;
ALTER TABLE "payment_orders" DROP COLUMN "amount";
ALTER TABLE "refunds" DROP COLUMN "amount";
