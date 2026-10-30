DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "products" WHERE "pricePaise" IS DISTINCT FROM ROUND("price" * 100)::INTEGER) THEN
    RAISE EXCEPTION 'price paise backfill comparison failed';
  END IF;
  IF EXISTS (SELECT 1 FROM "products" WHERE ("compareAtPrice" IS NULL) <> ("compareAtPricePaise" IS NULL) OR ("compareAtPrice" IS NOT NULL AND "compareAtPricePaise" IS DISTINCT FROM ROUND("compareAtPrice" * 100)::INTEGER)) THEN
    RAISE EXCEPTION 'compare-at price paise backfill comparison failed';
  END IF;
END $$;
ALTER TABLE "products" DROP COLUMN "price", DROP COLUMN "compareAtPrice";
