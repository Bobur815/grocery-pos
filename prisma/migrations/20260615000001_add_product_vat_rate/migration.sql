-- Add vat_rate to products (per-product VAT %, e.g. 0 or 12).
-- Null → fall back to the store-wide regos_vcr_vat default at fiscalization time.
-- Idempotent (ADD COLUMN IF NOT EXISTS) so it is safe to re-run and tolerant of
-- any out-of-band schema drift, per prior migration-recovery lessons.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "vat_rate" INTEGER;
