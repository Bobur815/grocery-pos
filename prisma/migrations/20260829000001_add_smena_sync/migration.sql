-- Shift (smena) mirror, so money reconciliation can see physical cash.
--
-- initial_cash / final_cash are the ONLY record of what was actually in the drawer. Without
-- them the server can compute what it EXPECTED to collect but never what it DID, which is why
-- MoneyReconciliationService has been returning limitation = 'NO_SHIFT_DATA_ON_SERVER'.
--
-- The per-shift totals are a snapshot computed on the terminal, not derived here. A return is a
-- hard-deleted Sale on this side, so after one the server can no longer reconstruct that
-- shift's takings — only the terminal that owned the drawer ever knew them.
--
-- PURELY ADDITIVE: two new tables, no existing column touched. Rollback is DROP TABLE.

CREATE TABLE "smenas" (
  -- the terminal's own cuid, reused verbatim so a re-send is an idempotent upsert
  "id"                TEXT NOT NULL,
  "store_id"          TEXT NOT NULL,
  "terminal_id"       TEXT NOT NULL,
  "cashier_id"        TEXT NOT NULL,
  "cashier_name"      TEXT NOT NULL,
  "status"            TEXT NOT NULL DEFAULT 'CLOSED',

  -- counted into the drawer at open, counted out of it at close
  "initial_cash"      DECIMAL(12,2) NOT NULL,
  "final_cash"        DECIMAL(12,2),

  "z_report_number"   INTEGER NOT NULL,
  "regos_z_report_id" INTEGER,

  -- terminal-computed totals; cash tender only for cash_sales_amount, since card and UzQR
  -- settle to the bank and never reach the till
  "cash_sales_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "card_sales_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "pay_in_total"      DECIMAL(12,2) NOT NULL DEFAULT 0,
  "pay_out_total"     DECIMAL(12,2) NOT NULL DEFAULT 0,
  "return_amount"     DECIMAL(12,2) NOT NULL DEFAULT 0,

  "opened_at"         TIMESTAMP(3) NOT NULL,
  "closed_at"         TIMESTAMP(3),

  -- distinct from closed_at: an offline terminal can push a shift days later
  "synced_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "smenas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "smenas_store_id_closed_at_idx" ON "smenas" ("store_id", "closed_at");
CREATE INDEX "smenas_store_id_terminal_id_idx" ON "smenas" ("store_id", "terminal_id");

CREATE TABLE "smena_movements" (
  "id"         TEXT NOT NULL,
  "smena_id"   TEXT NOT NULL,
  "type"       TEXT NOT NULL,
  "amount"     DECIMAL(12,2) NOT NULL,
  "note"       TEXT,
  "created_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "smena_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "smena_movements_smena_id_idx" ON "smena_movements" ("smena_id");

ALTER TABLE "smenas"
  ADD CONSTRAINT "smenas_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cascade: re-syncing a shift replaces its movements wholesale, so orphans must not survive.
ALTER TABLE "smena_movements"
  ADD CONSTRAINT "smena_movements_smena_id_fkey"
  FOREIGN KEY ("smena_id") REFERENCES "smenas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
