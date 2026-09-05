-- Per-store operating mode, and the rollout switch that gates its restrictions.
--
-- `mode` describes how a branch runs:
--   OFFLINE_ONLY — the terminal's SQLite is the source of truth; it never syncs and keeps full
--                  local admin CRUD.
--   ONLINE       — this server is the source of truth; the terminal is cashier-focused and its
--                  sync is narrowed to sales/shifts/heartbeat/logs.
--
-- `pos_admin_locked` is deliberately a SEPARATE knob from `mode`, not a consequence of it.
-- There is one real store live in ONLINE mode right now. Describing it accurately as ONLINE must
-- not, by itself, strip its terminal of admin CRUD the moment this migration lands. So every
-- existing row gets mode = ONLINE (true today) and pos_admin_locked = false (today's behavior),
-- and a super admin opts a branch in afterwards from /web/admin/stores. Flipping the flag back
-- is the rollback — it takes effect within one sync cycle and needs no new installer.
--
-- PURELY ADDITIVE: one new enum type and two defaulted columns. Nothing is dropped, renamed or
-- rewritten. Rollback is DROP COLUMN x2 + DROP TYPE.
--
-- Written idempotently (IF NOT EXISTS / DO-block guard) so it is safe to re-run, per prior
-- migration-recovery lessons.

DO $$ BEGIN
  CREATE TYPE "StoreMode" AS ENUM ('OFFLINE_ONLY', 'ONLINE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "mode" "StoreMode" NOT NULL DEFAULT 'ONLINE';
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "pos_admin_locked" BOOLEAN NOT NULL DEFAULT false;
