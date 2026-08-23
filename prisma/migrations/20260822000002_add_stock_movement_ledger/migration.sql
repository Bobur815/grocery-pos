-- Append-only ledger of everything that changes on-hand quantity.
--
-- Product.stock is a single mutable number written by seven different code paths; once a sale
-- is deleted or a stocktake overwrites stock, the evidence is gone and a period can no longer
-- be reconstructed. Reconciliation reads this table, never the source tables.
--
-- PURELY ADDITIVE: one new enum, one new table. No existing column is touched, nothing reads
-- it yet, and emission ships behind a flag. Rollback is DROP TABLE + DROP TYPE.

CREATE TYPE "StockMovementType" AS ENUM (
  'OPENING',
  'ARRIVAL',
  'ARRIVAL_ADJUSTMENT',
  'SALE',
  'SALE_REVERSAL',
  'SUPPLIER_RETURN',
  'STOCKTAKE_WRITE_OFF',
  'STOCKTAKE_ADJUSTMENT',
  'WRITE_OFF_DAMAGE',
  'WRITE_OFF_EXPIRY',
  'MANUAL_ADJUSTMENT',
  'REVALUATION'
);

CREATE TABLE "stock_movements" (
  "id"               TEXT NOT NULL,
  "store_id"         TEXT NOT NULL,
  "product_id"       INTEGER NOT NULL,
  "type"             "StockMovementType" NOT NULL,

  -- signed: positive adds, negative removes, REVALUATION is 0
  "quantity"         DECIMAL(14,3) NOT NULL,

  -- snapshots at event time, so variance valuation survives a mid-period re-pricing
  "unit_cost"        DECIMAL(10,2),
  "unit_price"       DECIMAL(10,2),

  -- absolute anchor; set ONLY by stocktake rows (the only absolute stock writes)
  "balance_after"    DECIMAL(14,3),

  -- false when the event happened but stock was deliberately not moved (stock_counted_at
  -- watermark): the row stays auditable without being counted twice
  "applied_to_stock" BOOLEAN NOT NULL DEFAULT true,

  "source_type"      TEXT,
  "source_id"        TEXT,
  "reason_code"      TEXT,
  "note"             TEXT,
  "actor_id"         TEXT,
  "actor_name"       TEXT,

  -- event time, distinct from created_at: an offline terminal can upload a week-old sale
  "occurred_at"      TIMESTAMP(3) NOT NULL,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- Idempotency, and load-bearing: sale sync retries, the arrival import loop swallows errors,
-- and the OPENING seed may be re-run. Without this one retry silently doubles a movement and
-- manufactures a variance that looks exactly like theft.
CREATE UNIQUE INDEX "stock_movements_source_type_source_id_product_id_type_key"
  ON "stock_movements" ("source_type", "source_id", "product_id", "type");

CREATE INDEX "stock_movements_store_id_product_id_occurred_at_idx"
  ON "stock_movements" ("store_id", "product_id", "occurred_at");
CREATE INDEX "stock_movements_store_id_occurred_at_idx"
  ON "stock_movements" ("store_id", "occurred_at");
CREATE INDEX "stock_movements_store_id_type_occurred_at_idx"
  ON "stock_movements" ("store_id", "type", "occurred_at");

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
