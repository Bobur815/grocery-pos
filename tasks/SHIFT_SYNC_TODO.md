# Shift (Smena) Sync — Stage B of Money Reconciliation

Closes the gap `money.service.ts` currently reports as `limitation: 'NO_SHIFT_DATA_ON_SERVER'`.
`Smena` / `SmenaMovement` hold `initialCash` / `finalCash` — the actual drawer count — but live
only in terminal SQLite with no sync path, so the server has nothing to compare expected cash
against.

## Design decisions

**Terminal computes, server stores.** The shift row carries its own reconciled snapshot
(expected vs actual) rather than the server recomputing from synced sales. Required, not a
shortcut: returns live in SQLite `audit_logs` as `delete_sale` entries, and the corresponding
server-side sale is hard-deleted — the server physically cannot reconstruct a shift's cash
sales after a return. Only the terminal that owned the drawer ever knows the true figure.

**Cash-only drawer math.** `isCashTender()` (`src/shared/constants/payment-methods.ts`) is the
single gate; card and UzQR settle to the bank and never touch the till.

```
expectedCash = initialCash + cashSales + payIn − payOut − cashReturns
cashVariance = finalCash − expectedCash      // negative = shortage in the drawer
```

**Naming stays `Smena`.** Matches SQLite so no translation layer between the two schemas.

**Only CLOSED shifts sync.** An OPEN shift has no `finalCash` — nothing to reconcile.

## Steps

- [x] 1. PG schema: add `Smena` + `SmenaMovement` to `prisma/schema.prisma`, store-scoped,
      with the stats snapshot columns. Purely additive — no existing table touched.
- [x] 2. `npm run prisma:migrate:dev` → migration file only, NOT deployed here.
- [x] 3. Server: `modules/smena/` — module, controller (`POST /smena/sync-bulk`), service,
      DTO. Idempotent upsert on shift id, same shape as `sales/sync`.
- [x] 4. POS: `src/main/sync/smena-sync.ts` — push CLOSED + unsynced shifts, mark `synced`.
- [x] 5. POS: call it from the sync cycle in `sync-service.ts` — NOT `uploadLocalData()`, which is
      ADMIN-gated. Shifts are closed by cashiers (USER role), so that path would never fire.
- [x] 6. Server: `money.service.ts` — fill `actuallyCollected` / `cashVariance` from synced
      shifts overlapping the period; keep the `limitation` field, now set only when the period
      genuinely has no shift data.
- [x] 7. Web: replace the `NO_SHIFT_DATA_ON_SERVER` banner with the real cash variance row.
- [x] 8. Unit tests for the variance arithmetic.

## Notes

- The SQLite `Smena.synced` column already exists and is unused — it was clearly left for this.
- Version bump: this touches `src/main/`, so bump before `npm run deploy:pos`.
- Rollout per CLAUDE.md: push to `dev` → verify migration on `posgro_staging` → merge to `main`.

## Review

All eight steps done. Server builds, 95 tests pass (10 new), web + root typecheck clean.

**Changed**
- `prisma/schema.prisma` — `Smena` + `SmenaMovement`, `Store.smenas` back-relation
- `prisma/migrations/20260829000001_add_smena_sync/` — written, NOT applied to any database
- `src/server/modules/smena/` — module, controller, service, DTO, `smena.math.ts` + tests
- `src/server/modules/reconciliation/money.service.ts` — real `cashVariance`; `limitation` is
  now set only when the period genuinely has zero synced shifts
- `src/main/sync/smena-sync.ts` + `sync-service.ts` — terminal push
- `src/web/.../ReconciliationPage.tsx`, `api/client.ts`, both locales — drawer cards

**Deviations from the plan**
- Step 5 moved out of `upload-sync.ts` (see above) — ADMIN gating would have silently disabled
  the whole feature on cashier terminals.
- `POST /smena/sync-bulk` is intentionally not `@Roles('ADMIN')` for the same reason. Store
  scoping still comes from the token via `StoreGuard`.

**Not done — needs a live environment**
- Migration never applied. `prisma migrate deploy` on staging is the next step, per CLAUDE.md.
- No end-to-end run against a real terminal + VPS.

**Notes**
- Every existing CLOSED shift on a terminal has `synced = false`, so the first cycles after the
  update backfill shift history at 20 per pass. Intended.
- `npm run lint` is broken repo-wide (ESLint 9, no flat config) — pre-existing, untouched.
- No version bump yet, per the bump-at-deploy convention.
