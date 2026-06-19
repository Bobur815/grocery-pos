-- Widen products.vat_rate from INTEGER to DOUBLE PRECISION so per-product VAT rates can carry
-- fractional values (e.g. 0.00 / 6.00 / 12.00). Non-destructive: existing whole-number rates
-- cast cleanly. Idempotent guard tolerates re-runs / out-of-band drift per migration-recovery lessons.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'vat_rate' AND data_type = 'integer'
  ) THEN
    ALTER TABLE "products" ALTER COLUMN "vat_rate" TYPE DOUBLE PRECISION USING "vat_rate"::double precision;
  END IF;
END $$;
