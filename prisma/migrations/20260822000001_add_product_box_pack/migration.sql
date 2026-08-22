-- Multi-piece pack ("box"): sell one catalog product either per piece or as a sealed
-- pack of N pieces. Stock stays counted in PIECES — a box sale decrements pieces_per_box.
--
--   pieces_per_box  null / 1 = not boxed (every existing row, so behaviour is unchanged)
--   box_price       price of one whole box; null falls back to price * pieces_per_box
--   box_barcode     optional second scannable code; scanning it sells a box with no prompt
--
-- sale_items.pieces_per_unit records how many pieces one sold `quantity` unit contained
-- (1 for a piece line, N for a box line) so stock restores on receipt edit/delete and the
-- fiscal quantity can be converted back to pieces. Defaults to 1 for all historical rows.
--
-- Idempotent (IF NOT EXISTS) so it is safe to re-run, per prior migration-recovery lessons.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "pieces_per_box" INTEGER;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "box_price" DECIMAL(10,2);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "box_barcode" TEXT;

ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "pieces_per_unit" INTEGER NOT NULL DEFAULT 1;

-- A box barcode must be unique within a store, mirroring products_store_id_barcode_key.
-- NULLs are excluded by Postgres, so unboxed products are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS "products_store_id_box_barcode_key"
  ON "products" ("store_id", "box_barcode");
