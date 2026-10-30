ALTER TABLE "orders" ADD COLUMN "totalAmountPaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "order_items" ADD COLUMN "pricePaise" INTEGER NOT NULL DEFAULT 0;
UPDATE "orders" SET "totalAmountPaise" = ROUND("totalAmount" * 100)::INTEGER;
UPDATE "order_items" SET "pricePaise" = ROUND("price" * 100)::INTEGER;
