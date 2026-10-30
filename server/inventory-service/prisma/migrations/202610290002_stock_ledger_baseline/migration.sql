INSERT INTO "stock_ledger" ("id", "productId", "delta", "reason", "createdAt")
SELECT gen_random_uuid()::text, s."productId", s."available" + s."reserved", 'BASELINE', CURRENT_TIMESTAMP
FROM "stocks" s
WHERE NOT EXISTS (SELECT 1 FROM "stock_ledger" l WHERE l."productId" = s."productId");
