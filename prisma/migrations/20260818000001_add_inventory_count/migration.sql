-- Inventarizatsiya (stocktake): a physical stock count as a document with a lifecycle.
--
-- Two new tables plus one column on products. Additive only — nothing is dropped or
-- rewritten, so this is safe against the live production data.
--
-- `products.stock_counted_at` is a watermark, not decoration. Completing a count writes
-- stock ABSOLUTELY, while every other server-side stock mutation is a delta. Without the
-- watermark, an offline terminal's pending sales would decrement a second time from the
-- freshly counted figure on reconnect (the bug that `POST /sales/unbackfill-stock` once
-- had to repair). Sale-sync now skips the decrement when the sale predates the count.
--
-- Written idempotently (IF NOT EXISTS / DO-block guards) so it tolerates out-of-band
-- schema drift and is safe to re-run, per prior migration-recovery lessons.

-- ---------- enums ----------
DO $$ BEGIN
  CREATE TYPE "InventoryCountStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "InventoryCountScope" AS ENUM ('FULL', 'CATEGORY', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------- products watermark ----------
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stock_counted_at" TIMESTAMP(3);

-- ---------- inventory_counts ----------
CREATE TABLE IF NOT EXISTS "inventory_counts" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "InventoryCountStatus" NOT NULL DEFAULT 'DRAFT',
    "scope" "InventoryCountScope" NOT NULL DEFAULT 'FULL',
    "category_id" INTEGER,
    "note" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "completed_by_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "counted_items" INTEGER NOT NULL DEFAULT 0,
    "total_difference" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "total_value_diff" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_counts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_counts_store_id_number_key" ON "inventory_counts"("store_id", "number");
CREATE INDEX IF NOT EXISTS "inventory_counts_store_id_status_idx" ON "inventory_counts"("store_id", "status");
CREATE INDEX IF NOT EXISTS "inventory_counts_store_id_created_at_idx" ON "inventory_counts"("store_id", "created_at");

-- ---------- inventory_count_items ----------
CREATE TABLE IF NOT EXISTS "inventory_count_items" (
    "id" TEXT NOT NULL,
    "count_id" TEXT NOT NULL,
    "product_id" INTEGER NOT NULL,
    "product_name" TEXT NOT NULL,
    "product_name_uz" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "expected_qty" DECIMAL(10,3) NOT NULL,
    "cost" DECIMAL(10,2),
    "counted_qty" DECIMAL(10,3),
    "difference" DECIMAL(10,3),
    "counted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "inventory_count_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_count_items_count_id_product_id_key" ON "inventory_count_items"("count_id", "product_id");
CREATE INDEX IF NOT EXISTS "inventory_count_items_count_id_idx" ON "inventory_count_items"("count_id");
CREATE INDEX IF NOT EXISTS "inventory_count_items_count_id_barcode_idx" ON "inventory_count_items"("count_id", "barcode");

-- ---------- foreign keys ----------
DO $$ BEGIN
  ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_count_id_fkey"
    FOREIGN KEY ("count_id") REFERENCES "inventory_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
