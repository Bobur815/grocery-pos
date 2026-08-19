# Inventarizatsiya (stocktake) — web/admin only

Goal: a physical stock count as a *document* (open → count → complete) in the web dashboard, so
shrinkage/breakage/drift can be reconciled. Until now the only way to change stock was deltas
(arrivals increment, sales decrement); `PATCH /products/:id` accepts an absolute `stock` but the UI
deliberately never sends it (`ProductForm.tsx:863`) because there was no audit trail.

Spec: `INVENTARIZATSIYA_IMPLEMENTATION.md` (repo root). Feature must NOT reach the Electron POS.

> Carried over from the previous task (Marking Check): **User — deploy `dev`, then paste the freshly
> generated Asl-Belgisi key on the Marking Check page.** Still outstanding.

## Decisions (settled 2026-08-18)

- **Watermark, not a warning.** Completing a count is the system's only *absolute* stock write.
  An offline terminal holds sales whose stock was already decremented locally; without a guard those
  sales decrement a second time from the counted figure on reconnect. (`POST /sales/unbackfill-stock`
  exists because this exact class of bug already hit the repo.) Added `Product.stockCountedAt` and
  one `AND` clause in sale-sync.
- **Sidebar: new "Ombor" section, not a collapsible parent.** The spec asked for an expand/collapse
  parent; no such pattern exists in `Sidebar.tsx` (flat `renderNavItem` inside `NavSection` groups)
  and it degrades badly in the 70 px mini-sidebar. A section with two flat children matches how
  Reports/Management are already grouped.
- **Scopes FULL + CATEGORY.** `CUSTOM` is in the enum and rejected by the service; adding it later
  needs a product-picker UI but no schema change.
- **No AuditLog.** The spec says to write one; the model was dropped in
  `20260629000001_drop_audit_logs`. The count document *is* the audit record — immutable once
  completed, storing who/when and the per-line difference.
- **Everything store-scoped.** The spec's models had no `storeId` and a globally-unique `number`;
  as written they would have leaked counts across tenants.

## Tasks

- [x] `prisma/schema.prisma` — `InventoryCountStatus`/`InventoryCountScope` enums,
      `InventoryCount` + `InventoryCountItem`, `Product.stockCountedAt`, back-relations on
      `Store`/`Product`. Per-store `@@unique([storeId, number])`.
- [x] `prisma/migrations/20260818000001_add_inventory_count/migration.sql` — hand-written,
      idempotent (`IF NOT EXISTS` / `DO $$ … EXCEPTION`), additive only.
- [x] `src/server/modules/inventory-count/` — dto ×3, service, controller, module; registered in
      `app.module.ts`. Guards `JwtAuthGuard, StoreGuard, RolesGuard` + `@Roles('ADMIN')`.
- [x] `src/server/modules/sales/sales.service.ts` — `stock_counted_at` guard in `syncSale()`.
- [x] `src/server/modules/products/products.service.ts` — `hardDelete()` clears
      `inventoryCountItem` rows (the new FK is RESTRICT and would otherwise block deletion).
- [x] `src/renderer/components/common/Table.tsx` — optional `onRowClick` (additive; POS unaffected).
- [x] `src/web/src/api/client.ts` — `inventoryCounts` namespace + inline types.
- [x] `src/web/src/App.tsx` — `products/stock/inventarizatsiya[/:id]`, `adminOnly excludeSuperAdmin`.
- [x] `src/web/src/components/layout/Sidebar.tsx` — Ombor section (Kirimlar `end` + Inventarizatsiya),
      admin-only mobile bottom-nav entry.
- [x] `src/web/src/pages/Products/InventoryCountList.tsx`, `InventoryCountDetail.tsx`,
      `CreateInventoryCountModal.tsx`, `InventoryCountStatusBadge.tsx`.
- [x] `src/renderer/i18n/locales/{ru,uz}.json` — `nav.arrivals`, `nav.stocktake`, `inventoryCount.*`.
- [x] `nest build`, `src/web` `tsc --noEmit && vite build`, root `tsc --noEmit` (0 errors), 40/40 tests.

## Review

**Design corrections against the spec.** Three parts of `INVENTARIZATSIYA_IMPLEMENTATION.md` do not
compile or are unsafe against this codebase and were changed deliberately: the `AuditLog` write (model
dropped), the missing `storeId`/global `number` (multi-tenant leak), and the per-row `await` loop in
`complete()` — a full-store count is thousands of rows and would blow Prisma's 5 s interactive
transaction timeout, so completion uses two set-based `UPDATE … FROM (VALUES …)` statements chunked
at 500 with an explicit 120 s timeout.

**The one real risk, and the fix.** Absolute stock writes in a delta-only system double-decrement
pending offline sales. `complete()` stamps `stock_counted_at = NOW()`; `syncSale()` now runs

```sql
WHERE id = $serverId
  AND (stock_counted_at IS NULL OR stock_counted_at < $saleCreatedAt::timestamptz)
```

so a sale that predates the count is skipped (and logged as skipped) rather than applied twice.
`updated_at = NOW()` is set explicitly in the completion SQL — raw SQL bypasses Prisma's `@updatedAt`
and terminals pull products via an `updatedAfter` cursor, so omitting it would mean the count never
reaches the POS.

**Bugs caught during self-review, before finishing.**
1. `hardDelete()` would have thrown a FK violation for any product appearing in a count — the new
   `InventoryCountItem.productId` FK is RESTRICT. Now cleaned up alongside sale items and arrivals.
2. The counted-qty input skipped the request when the typed value equalled `Number(item.countedQty)`
   — but `Number(null)` is `0`, so typing **0** on an uncounted line silently did nothing. That is
   precisely the `null` ("not counted") vs `0` ("counted, found nothing") distinction the spec calls
   out. Guarded on `item.countedQty !== null`.
3. The stocktake mobile bottom-nav icon was shown to cashiers, who would be bounced by `adminOnly`.
   Now admin-only.

**Other deliberate deviations.** `PATCH /:id/items/:itemId` and `POST /:id/scan` return only the
touched line plus progress counters, not the whole document — the spec's `return this.findOne()`
would re-send thousands of rows on every keystroke. `create()` also refuses to open a second
document while one is DRAFT/IN_PROGRESS; two concurrent counts would fight over the same stock.

**Reuse.** No new primitives: `Table`/`Modal`/`Button`/`Input`/`Select`/`Pagination`/`ConfirmDialog`/
`EmptyPlaceholder`/`Spinner` from `@components/common`, `MobileCard`/`MobileCardList`/`DesktopOnly`
for the ≤768 px card layout, `useToast`, `debounce`, `formatDateTime`, `formatCurrency`. The camera
scan on the counting page is the existing `BarcodeScannerModal` (BarcodeDetector + ZXing fallback for
iOS Safari) — that is what makes the phone workflow usable while walking the aisles.

**Migration verified without a database.** The local Postgres credentials in `.env` are wrong
(`P1000` on both :5432 and :5433) and there is no Docker, so the migration could not be applied. It
was instead diffed against Prisma's own canonical output:
`prisma migrate diff --from-schema-datamodel <HEAD schema> --to-schema-datamodel <new schema> --script`
— **identical** after normalising comments and the idempotency guards. Same columns, types, defaults,
index names, constraint names and FK actions, so `migrate deploy` will apply cleanly and leave no drift.

**NOT verified end-to-end:** nothing has been run against a live database or browser. Before merging
to `main`, on staging (`dev` auto-deploys and runs `migrate deploy` against `posgro_staging`):
1. Partial-count test — count 2 of N lines, complete, confirm those 2 products match the counted
   values and **every uncounted product is unchanged**.
2. Watermark regression — server stock 100; take a terminal offline and sell 5 (local → 95); complete
   a count of 95; reconnect. **Server must still read 95, not 90.** Control: a *new* sale of 2
   afterwards must take it to 93.
3. Completed document read-only, Cancel rejected on it, second open count refused, non-ADMIN → 403.
4. 360 px: list → cards, no horizontal scroll; steppers ≥44 px; sticky action bar; camera scan
   (needs HTTPS for `getUserMedia`).

**Pre-existing, untouched:** `npm run lint` is still broken repo-wide — ESLint 9 needs
`eslint.config.js` and the repo only has the legacy config. Typechecking was used instead.

**Not bumped:** `package.json` version. Changes are server + `src/web` + i18n keys the POS never
reads; the only shared-component edit (`Table.onRowClick`) is optional and behaviour-neutral for the
Electron app, so there is nothing to `deploy:pos`.
