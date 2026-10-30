DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "orders" WHERE "totalAmountPaise" IS DISTINCT FROM ROUND("totalAmount" * 100)::INTEGER) THEN
    RAISE EXCEPTION 'order total paise backfill comparison failed';
  END IF;
  IF EXISTS (SELECT 1 FROM "order_items" WHERE "pricePaise" IS DISTINCT FROM ROUND("price" * 100)::INTEGER) THEN
    RAISE EXCEPTION 'order item paise backfill comparison failed';
  END IF;
END $$;
ALTER TABLE "orders" DROP COLUMN "totalAmount";
ALTER TABLE "order_items" DROP COLUMN "price";
