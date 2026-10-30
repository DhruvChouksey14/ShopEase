ALTER TABLE "products" ADD COLUMN "pricePaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "products" ADD COLUMN "compareAtPricePaise" INTEGER;
UPDATE "products" SET "pricePaise" = ROUND("price" * 100)::INTEGER,
  "compareAtPricePaise" = CASE WHEN "compareAtPrice" IS NULL THEN NULL ELSE ROUND("compareAtPrice" * 100)::INTEGER END;
