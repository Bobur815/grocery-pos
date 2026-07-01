-- Add is_marked to products: authoritative Asl-Belgisi mandatory-marking flag,
-- backfilled from tasnif `label` (1 = marked, 0 = plain).
-- Null (default for existing rows) = not yet checked → the POS falls back to the
-- isMarkedMxik(mxik) group-020/022 heuristic via productRequiresMarking().
-- Idempotent (ADD COLUMN IF NOT EXISTS) so it is safe to re-run and tolerant of
-- any out-of-band schema drift, per prior migration-recovery lessons.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_marked" BOOLEAN;
