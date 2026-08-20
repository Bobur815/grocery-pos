-- Write-off of uncounted stocktake lines.
--
-- Completing a count can now optionally treat every uncounted line as "not physically
-- present" and set its stock to 0. The three columns on inventory_counts are the
-- denormalized summary (same rationale as counted_items / total_value_diff: the list page
-- renders a document without loading its items). written_off on the item is what
-- distinguishes a line that was zeroed by the write-off from one that was physically
-- counted and found to be zero -- `counted` stays false for the former.
--
-- write_off_value is a SUBSET of total_value_diff, not an addition to it: written-off rows
-- flow through the same difference/total arithmetic as counted rows.
--
-- Additive only -- four nullable-by-default columns, no rewrites, no drops. Written
-- idempotently so it tolerates schema drift and is safe to re-run.

ALTER TABLE "inventory_counts"
  ADD COLUMN IF NOT EXISTS "wrote_off_uncounted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "written_off_items"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "write_off_value"     DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "inventory_count_items"
  ADD COLUMN IF NOT EXISTS "written_off" BOOLEAN NOT NULL DEFAULT false;
