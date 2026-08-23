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

## Follow-up: write off uncounted items (2026-08-20)

Completing a count left uncounted lines untouched, so a product that never turned up during a
category count stayed "in stock" forever. Added an opt-in write-off at completion.

- [x] `prisma/schema.prisma` — `InventoryCount.wroteOffUncounted / writtenOffItems / writeOffValue`,
      `InventoryCountItem.writtenOff`. Migration `20260820000001_add_inventory_count_writeoff`,
      hand-written and idempotent, verified column-for-column against `prisma migrate diff`.
- [x] `dto/complete-count.dto.ts` — `writeOffUncounted?: boolean`; controller passes it through.
- [x] `inventory-count.service.ts` — extracted the completion arithmetic into a pure exported
      `planCompletion(items, writeOffUncounted)`; `complete()` now just executes the plan.
- [x] `inventory-count.plan.test.ts` (new) — 9 tests over `planCompletion`.
- [x] `CompleteCountModal.tsx` (new) — replaces the completion `ConfirmDialog` (which takes only
      strings) with a checkbox + numeric preview + the FULL-scope acknowledgement.
- [x] Written-off pill on detail lines (table + mobile card), write-off row in the SummaryBar,
      write-off note in the list's difference cell.
- [x] `inventoryCount.detail.writeOff.*` in ru/uz; API client types + `complete` payload.
- [x] `nest build`, web `tsc --noEmit && vite build`, root `tsc --noEmit` (0), 49/49 tests.

**Design: a written-off line travels the existing code path.** It is emitted as `countedQty = 0`,
`difference = −expectedQty`, `writtenOff = true`, `counted` still false — so the same chunked
`UPDATE products … FROM (VALUES …)` writes it, including `stock_counted_at` and `updated_at`. No
parallel branch, and the invariant `difference = countedQty − expectedQty` holds on every row.
`countedItems` keeps meaning *physically counted*; write-offs are counted separately.

The watermark is correct here, not just inherited: the count asserts the goods are not on the shelf,
so an offline sale predating it is already reflected and must not decrement again. A delta write
(`GREATEST(0, stock − qty)`) was considered and rejected — it would have made write-offs behave
differently from counted lines for no benefit.

**Two guards.** The existing `countedItems === 0` check is now load-bearing in a new way: without it,
"create a count, count nothing, tick write-off" would zero the document's whole scope in one click.
And a FULL-scope write-off needs a second acknowledgement naming the exact product count, so three
deliberate actions stand between a click and a store-wide zeroing.

**Uncounted lines with `expectedQty = 0` are skipped.** Writing 0 over 0 changes nothing but bumps
`updated_at`, which would make every terminal re-pull thousands of rows on the next products-sync.

**Scope containment is structural, not enforced.** A document's items are snapshotted at creation
from `{ storeId, active: true, categoryId? }`, and the write-off only ever touches the document's own
lines — so a Fruits count cannot reach a beverage. Worth keeping that property in mind before anyone
adds multi-category counts.

**i18n footgun avoided:** the interpolation variable is `{{n}}`, not `{{count}}` — i18next reserves
`count` for pluralization and would look for `label_one`/`label_few`/`label_many` in RU first.

**NOT verified end-to-end:** nothing has run against a live database. `planCompletion` is unit-tested
(including the fractional case, where float arithmetic would have produced 0.30000000000000004), but
the raw SQL — in particular writing `counted_qty` and `written_off` through the extended `VALUES`
tuple — has not executed. Run cases 1–8 in the plan file on staging, especially: partial count with
write-off off must still leave uncounted stock alone; a Fruits write-off must leave a Beverages
product untouched; and an `expectedQty = 0` line must come back `writtenOff = false`.

**Known gap, deliberately not built:** writing off a marked (group-022) product plausibly carries an
Asl-Belgisi registry obligation — the registry has a real `WRITTEN_OFF` status — and nothing reports
it. Also out of scope: a losses report. `src/server/modules/analytics/` is sales-only and derives COGS
from `sale_items`, so write-offs are invisible to every existing report; the document is the record.
Non-fiscal, like the stocktake: REGOS has no write-off method, its whole surface is receipt-based.

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

---

## Write-off product list (2026-08-20)

The write-off decision was numbers-only: the confirm dialog said "списать 36 товаров · −214 шт
(−1 240 000)" and the closed document showed the same total in the summary bar. *Which* products
got zeroed was never shown — only a per-line "Списан" pill scattered through a list that can run to
thousands of rows. For the one irreversible write in the whole feature, that is not enough to
approve or to audit afterwards.

- [x] `WriteOffList.tsx` — shared read-only row list (name + barcode / `−qty unit` + `−value`),
      sorted by loss descending (qty as the tiebreak for cost-less lines), capped at 50 rows with a
      "… ещё N товаров" tail so a full-store count doesn't render thousands of nodes. Rows are
      `flex-wrap`, so the amounts drop under the name on a phone instead of squeezing it — one
      component covers desktop and mobile, no media query.
- [x] `CompleteCountModal` — collapsible "Показать список (N)" preview above the confirmation, in a
      260 px scroll panel so the modal stays inside its 90 vh and the buttons stay reachable. The
      disclosure sits **outside** the `<OptionBox>` label; inside it, every click would have toggled
      the write-off checkbox. Modal widened to 560 px (desktop only — the container is `width: 90%`).
      The list is available whether or not the box is ticked, so it can be inspected before deciding.
- [x] `InventoryCountDetail` — the "Списано" summary tile became a real `<button>` that filters the
      document to the written-off lines, plus a matching "Только списанные (N)" toggle beside the
      existing filters and a banner with the totals over the filtered view. Both filters clear each
      other (written-off lines are uncounted by definition, so the intersection is a confusing
      partial view). The desktop `<Table>` and the `<MobileCardList>` both read `visibleItems`, so
      one filter serves both layouts.
- [x] i18n `showList` / `hideList` / `more` / `onlyWrittenOff` / `listTitle` / `showAll` in ru + uz.

**No server change.** `writtenOff`, `expectedQty`, `cost`, `unit` are already on every item and
`writtenOffItems` / `writeOffValue` on the document — this is presentation only. CSV / printable
"акт списания" was considered and explicitly declined.

**Verified:** `cd src/web && npm run build` (tsc --noEmit + vite build) clean. **Not verified:** no
browser — the Chrome extension was not connected, so nothing was eyeballed. Still to check on
staging: the disclosure does not untick the write-off checkbox, the 260 px panel scrolls without
burying the modal buttons, and at ~390 px the rows wrap instead of overflowing.

**Not bumped:** `package.json`. `src/web` + i18n keys only; the POS renderer has no stocktake UI.

---

## UzQR payment method (2026-08-20)

Third sale tender alongside cash and card, branded with the customer-supplied UzQR
wordmark. **Tender only** — this is NOT the REGOS `Payment.*` QR flow from
`UZQR_INTEGRATION_TODO.md`: no `Payment.Create`, no `qr_text` on screen, no polling. The
cashier takes payment through the store's existing UzQR QR, then records the tender. That
plan doc stays open; its blockers (no confirmed `payment_system_id=5` test key, unverified
status enum) are untouched by this.

- [x] Logo asset `src/renderer/assets/uzqr.png` + a `*.png` declaration scoped to that
      folder (the renderer tsconfig has no `vite/client`; the web project already gets the
      same declarations from its own `types`, so the d.ts must not be visible to both).
- [x] `UzQrLogo` (`pages/POS/`, not `components/common` — `common` is the surface the web
      dashboard also compiles, and this asset is POS-only). Navy field
      `UZQR_BRAND_COLOR` + `background-size: contain`, sized off the artwork's own
      451:171 ratio, so one component serves the wide checkout tile and the small
      quick-pay mark. `cover` would crop the wordmark on the narrow button.
- [x] Checkout modal: third tile, grid → `repeat(3, 1fr)`. No text — the artwork is the
      label (`aria-label` carries the accessible name). Selected state is a ring, not the
      pale primary wash the other two use, which is invisible on navy.
- [x] POS quick-pay: third button on **F9** (cash F11, card F12 unchanged), row → 3 cols.
- [x] Shared vocabulary in `constants/payment-methods.ts`: `SALE_TENDERS`, `SaleTender`,
      `SALE_TENDER_I18N_KEYS`, `UZQR_BRAND_COLOR`, and `isCashTender()`. Documented as
      distinct from the pre-existing upper-case `PAYMENT_METHODS` block — the POS has
      always written lower-case values and the two vocabularies were never the same.
- [x] i18n `pos.uzqr` + `reports.uzqrPayments` (ru + uz).

**The bug this avoids.** Every summary counted `=== 'cash'` and `=== 'card'` by equality,
so a third value would have been counted in *neither* — UzQR sales would vanish from the
stat tiles while still inflating `totalSales`. Fixed with a real third bucket (not folded
into card) in: `sales-handlers.ts` (JS filter + the raw-SQL `CASE WHEN`), the server's
`sales.service.ts`, and all four report pages (renderer + web × daily/monthly). Tiles
render only when `uzqrSales > 0`, so nothing changes for stores that don't take UzQR.

**Drawer split.** `smena-handlers.ts` bucketed `cash` vs `else`, which was already correct
for UzQR — rewritten as `isCashTender()` and commented, so the "is it cash" question stays
the one being asked. Only cash is money in the till; card and UzQR both settle to the bank.

**Fiscalization needed no change.** `buildPayments()` already falls through to
`{type: 2, card_type: 2}` for anything non-cash, which is exactly how REGOS books UzQR.
Made explicit with a comment rather than left to the fallback. No `payment_id` is sent
because the POS does not drive `Payment.Create`.

**No schema change.** `sales.payment_method` is a free-form `String` in both the SQLite and
PostgreSQL schemas — no enum, no migration, and existing rows are untouched.

**Verified:** `npx electron-vite build` (asset emitted as
`dist-renderer/assets/uzqr-B_ULtuoS.png`, referenced via
`new URL(..., import.meta.url)` — the form that survives `file://` in the packaged app,
and `dist-renderer/**/*` is already in electron-builder's `files`), `cd src/web && npm run
build`, `npm run build:server`, and `tsc --noEmit` on both projects.
**Not verified:** no browser or running app — the tiles have not been looked at, and no
sale has been rung through end to end.

**Not bumped:** `package.json`. Touches renderer + main, so it DOES need a bump — do it at
deploy time together with whatever else ships, then `npm run deploy:pos`.

---

## Fix: write-off must be per-product, not all-or-nothing (2026-08-20)

`complete(writeOffUncounted: boolean)` zeroed **every** eligible uncounted line. But
"uncounted" is not "gone": stock can be in transit, delivered-but-not-unpacked, or held
back for a customer, and it arrives days later. Zeroing those destroyed real stock that the
next delivery was about to confirm — and because completion is immutable, the only recovery
was a manual re-count. The operator now picks the lines that are genuinely gone.

- [x] `planCompletion(items, writeOff)` — second arg widened from `boolean` to
      `WriteOffSelection = boolean | ReadonlySet<string>`. `true`/`false` behave exactly as
      before, so all pre-existing tests and callers are untouched.
- [x] Selection is an **intersection with the eligibility rule, never a widening**: an id
      that isn't an uncounted, in-stock line of *this* document is ignored. A stale or
      hand-crafted id list therefore cannot reach another document's line, resurrect a
      zero-stock line, or overwrite a line the cashier actually counted.
- [x] `CompleteCountDto.writeOffItemIds?: string[]` (`@ArrayMaxSize(10000)` — a full-store
      count is thousands of lines). The controller treats a present list as authoritative
      **even when empty**; falling back to the boolean there would turn "I deselected
      everything" into "write off the whole document".
- [x] 3 new tests (12 total in the suite, 52 repo-wide): subset writes off only the picked
      lines and emits **no row at all** for the kept ones; empty set = no write-off;
      ineligible/foreign ids are ignored.
- [x] `WriteOffList` gained optional `selected`/`onToggle`/`onShowMore`. Deselected rows go
      dimmed + struck-through, so a line that will NOT be zeroed cannot read as a loss.
- [x] `CompleteCountModal` — search box, select-all/clear-all, "show more", a running
      "{{n}} останутся без изменений" line, and the impact totals recomputed from the
      selection rather than from all eligible lines.
- [x] i18n `choose`/`selectAll`/`clearAll`/`showMore`/`keeping` in ru + uz; key parity
      checked programmatically.

**Selection state is `Set<string> | null`, not a plain Set.** `null` means "not narrowed
yet" and behaves as every eligible line, so ticking the box and confirming still writes off
everything exactly as it did before — the picker is opt-in and costs the existing one-click
flow nothing. It materialises into a real set on the first toggle.

**The row cap was a correctness bug once rows became selectable.** The list rendered only
the first 50 of potentially thousands; a line the operator cannot see is one they cannot
deselect, and it would have been zeroed silently. Hence the search box and "show more" —
every eligible line is now reachable. This is why the cap could stay a plain slice before
and cannot now.

**Confirm now sends ids, never the boolean.** `onConfirm(writeOffItemIds: string[])`, and
`handleComplete` posts `{ writeOffItemIds }` verbatim, so the server never re-derives the
set the operator was looking at. The boolean stays on the DTO for compatibility.

**Verified:** 52/52 tests, `nest build`, `src/web` build + `tsc --noEmit`.
**Not verified:** no browser and no live database — the picker has not been clicked, and no
completion has run against Postgres. On staging, the case to prove is the reported one:
two uncounted products, deselect one, complete → the deselected product's stock must be
**unchanged**, and it must come back `writtenOff = false` with no row written for it.

---

# Boxed products — sell per piece or per whole box (2026-08-22)

Goods that arrive in multi-piece packs (hair dye ×2, razor packs ×2–10) are sold both ways.
The catalog had one price and one barcode per product, so staff either kept a duplicate
"box" product (two stock rows that drift apart) or rang up N pieces by hand (losing the
pack discount). Now a product carries an optional pack, and the cashier is asked which unit
before the line is created.

## The one invariant

**Stock is always counted in PIECES.** A cart line / `SaleItem` keeps `quantity` in SALE
units with the matching `unitPrice`, plus `piecesPerUnit` (1 = piece, N = box). Everything
that touches stock, cost, or a physical count multiplies through `toPieces()`.

```
2 boxes of 5 @ 45 000 → quantity 2, unitPrice 45 000, piecesPerUnit 5, subtotal 90 000
   stock            −10 pieces
   fiscal quantity   10 000 (10 pcs ×1000), amount 9 000 000 → 9 000/piece ✓
```

Storing pieces and dividing the box price was rejected: `boxPrice / piecesPerBox` does not
divide evenly in tiyin, so subtotals would drift off what the customer actually paid and
REGOS' `amount ≈ Σ payments` check (±50) would eventually fail.

## Done

- [x] `src/shared/utils/pack.ts` — `PIECE`, `isBoxedProduct`, `toPieces`, `boxUnitPrice`.
      11 unit tests; `toPieces` falls back to 1 for null/0/negative/NaN so a bad payload can
      never zero out or reverse a stock decrement.
- [x] Schema both sides: `products.pieces_per_box / box_price / box_barcode`,
      `sale_items.pieces_per_unit INT NOT NULL DEFAULT 1`. PG migration
      `20260822000001_add_product_box_pack` + **the raw-SQL path in `sqlite-client.ts`**
      (migration 26), which is what actually maintains terminal DBs.
- [x] Full sync plumbing: shared types, both product DTOs, `products.service` create/
      syncBulk/findByBarcode, `products-sync.ts` (both create AND update lists),
      `serializeProduct`, `upload-sync`, sale sync + `sync-sale.dto`.
- [x] `SaleUnitModal` + gates in all three add paths (scan / product-id / catalog).
- [x] Stock conversion at all six sites in `sales-handlers.ts`, plus the server's own
      decrement in `sales.service.ts`.
- [x] Fiscal `buildPositions` reports pieces; cart badge, quantity label, printed receipt.
- [x] Web admin form: pack size, box price (auto-suggested, overridable), box barcode.

## Four things worth knowing

**Box mode is refused for marked goods.** Each physical piece carries its own DataMatrix and
a fiscal position accepts at most one `label`, so a box of 5 marked pieces cannot be
fiscalized as one line. `needsSaleUnitChoice` excludes them, and the web form hides the pack
fields when `isMarked` is set.

**Fiscal quantity is PIECES, not boxes.** `package_code` is auto-set to the *smallest* tasnif
package (`pickSingleUnitPackage`), i.e. the product is registered as sold per piece. REGOS
re-derives the unit price as `amount / quantity`, so sending 1 for a box would imply the box
price and contradict the registered package. Sending 1 would only be right if `package_code`
were switched to a `…=N шт` package.

**The hotkeys are F1/F2, deliberately not 1/2.** A scanner emits digits and a trailing Enter.
With bare digits and a focused button, a stray scan while the modal was open would silently
pick a unit and put the wrong money in the cart. Scanners cannot emit function keys. The
modal also parks focus in a hidden `ScanSink` so a mid-modal scan is swallowed, and
POSScreen's global keypad handler now early-returns while the modal is open (it previously
bailed only for the checkout/smena modals).

**Every "units sold" and cost-of-goods figure was converted too.** `SUM(si.quantity)` would
have counted a box as one unit and `SUM(si.quantity * p.cost)` would have charged one piece's
cost for a whole box — overstating margin. Seven sites now multiply by `pieces_per_unit`
(4 SQL, 3 JS) across terminal reports and server analytics. Safe for all history because the
column is `NOT NULL DEFAULT 1`.

**Verified:** 63/63 tests; `tsc --noEmit` clean on both projects; `nest build`, `src/web`
build, and `electron-vite build` all green. Migration 26 replayed on a throwaway SQLite DB
of the old shape — existing rows get NULL pack fields, historical `sale_items` backfill to
`pieces_per_unit = 1`, and the box-barcode unique index accepts many NULLs but rejects
duplicates. Report SQL checked against a fixture: a 2×5 box line plus a 3-piece line yields
13 pieces / 78 000 cost.

**Not verified:** no live run. Not exercised: the modal on a real terminal, a real scan of a
box barcode, a REGOS `ValidateSale` with a box line, and pull-sync of the three new columns
from the VPS. See the plan's verification section.

**Note:** `products:getTopSelling` still ranks by `_sum: { quantity }` (Prisma `groupBy`
cannot multiply). A box counts as 1 there — it only affects catalog ordering, no figure is
shown to anyone.

---

# ProductForm split into 3 tabs (2026-08-22)

Both product forms had grown to one ~25-field scroll. Split into **General / Tax / Photo** in
`src/renderer/pages/Products/ProductForm.tsx` and `src/web/src/pages/Products/ProductForm.tsx`.

## Layout

**General** — the five required fields in sequence, nothing else visible:
barcode (+generate) | category (+manage) → nameUz | nameRu → price.
Everything optional sits behind a collapsed **"Дополнительные поля"** fold: cost, stock,
minStock, unit, productType, supplier, internalCode (conditional), the box-pack row (web),
production/expiry dates, discount, promotion.

**Tax** — MXIK (+catalog picker), VAT rate, package code, and on web the Asl-Belgisi marking
select. MXIK is required but lives here because it *is* the tax classification code.

**Photo** — dashed placeholder with a lucide `ImageIcon` and a "Скоро / Tez orada" message.

## The one non-obvious problem

**Hiding a `required` input breaks native validation.** Only the active tab is mounted, so the
browser can only validate what is on screen — a missing MXIK on the Tax tab would sail through
submit unnoticed. (Keeping all tabs mounted and hidden with CSS is worse: Chrome throws
"An invalid form control is not focusable" and the form silently refuses to submit at all.)

Fixed with `firstInvalidTab()`, checked at the top of `handleSubmit`: it returns the tab
holding the first missing required field, the form switches to it and toasts
`products.fillRequired`. The `required` attributes stay so the active tab still gets native
validation.

Also: every `Tab` and the `FoldToggle` carry `type="button"` — inside a `<form>` a bare
`<button>` defaults to submit, so switching tabs would have saved the product.

## Verified

`tsc --noEmit` clean on both projects (it fully parses JSX and resolves every identifier),
`electron-vite build` + `src/web` build green, 63/63 tests, ru/uz `products` key parity 99/99.
Field-level check: the set of `formData.*` bindings is identical to HEAD in both files — no
field lost in the move — and each label appears exactly once in the form (the extra hits are
the separate "product exists"/arrival modal).

**Not verified:** no visual run. The tab bar, fold, and placeholder have not been seen in a
running app; login credentials would be needed to reach the form.

---

# Stock & Money Reconciliation + Movement Ledger (2026-08-22)

Per `RECONCILIATION_SETUP.md`. Answers *"a month passed — does everything reconcile to zero?"*
Backend + read-only web UI. Additive only; nothing on the terminal changed.

## Findings that changed the design

**The brief describes the stocktake write-off incorrectly.** It is not "products not included in
the selected stocktake" — every in-scope product *is* a line. It targets lines **inside** the
document that were never counted (`!counted && expectedQty > 0`), is opt-in (`writeOff` defaults
to `false`), accepts an explicit id set, intersects rather than widens, and is guarded by
`countedItems === 0 → throw`. It is also **already auditable** — `InventoryCountItem` keeps
`expectedQty`, `countedQty`, `difference`, `writtenOff`, `cost`. Behaviour left untouched; the
ledger row is written alongside it.

**The `stockCountedAt` watermark is the load-bearing constraint, and the brief never mentions it.**
`sales.service.ts:148` skips the decrement when a sale predates the last count. So
`Σ movements from OPENING` can *never* equal `Product.stock` on any store that has counted.
Solved with `balanceAfter` (an absolute anchor, written only by stocktakes) plus `appliedToStock`
(the row stays auditable but is not summed). The engine recomputes forward from the latest anchor
instead of from the beginning of time.

**Money reconciliation has no "actual collected" side.** `Smena`/`SmenaMovement` hold
`initialCash`/`finalCash` and exist **only in SQLite** — no PG model, no endpoint, no sync path.
Shipped Stage A (tender breakdown) with `actuallyCollected: null` and an explicit `limitation`
code so the UI says "not available" rather than implying a perfect reconciliation. Stage B
(sync shifts up) is a separate follow-up; the response shape already has the slots.

**`finalAmount` is already net of discount**, so the brief's `Expected = sales − nasiya −
discounts` double-subtracts. Discounts are reported, never subtracted again.

## Built

- [x] `StockMovement` + `StockMovementType` (PG only). Hand-written migration verified against
      `prisma migrate diff` output — identical column types, index names and FK actions.
- [x] `StockMovementService` — flag-gated (`RECONCILIATION_LEDGER_ENABLED`, default off),
      `createMany({ skipDuplicates: true })`, emission failures logged not thrown.
- [x] All **seven** emission points: arrival create / edit / bulk-import, sale sync, sale delete,
      stocktake completion (both counted and written-off lines), supplier return.
- [x] `reconciliation.math.ts` — pure, DB-free, **17 unit tests**.
- [x] `ReconciliationService` (goods + `seedOpening`), `MoneyReconciliationService` (Stage A),
      controller behind `JwtAuthGuard + StoreGuard + RolesGuard @Roles('ADMIN')`.
- [x] `web/products/stock/reconciliation` page, RU/UZ (31 keys, parity checked).

## Three details worth keeping

**Sale movements are keyed on the sale ITEM, not the sale.** One sale can hold two lines for the
same product — a pending-price split, or a box line beside a piece line. Keying on the sale id
would make them collide and `skipDuplicates` would silently drop the second, under-reporting
goods sold.

**`sourceType`/`sourceId` are required in the emitter's TypeScript API** even though the columns
are nullable. Postgres treats NULLs as distinct in a unique index, so a null source would never
collide and the retry protection would silently not apply. Making the API demand both means a
caller cannot accidentally opt out.

**The cross-check runs to *now*, not to `periodEnd`.** "Does the ledger still describe today's
stock?" is a different question from "what moved during the period", and only the first one
detects a decrement that never fired.

## Verified

80/80 tests (17 new), `tsc --noEmit` clean on both projects, `nest build` + web build green.
`inventory-count.plan.test.ts` still passes untouched.

## NOT done — needs the user

- [x] **§1.8 CONFIRMED AND FIXED (2026-08-23).** The user reproduced it against the VPS: selling
  one box of 5 removed 5 units, deleting the synced sale returned only 1 — 4 units of book stock
  lost per deleted box line, which would then propagate back to the terminal on the next product
  pull. `deleteById` now multiplies through `toPieces()` and does a single atomic
  `UPDATE ... SET stock = stock + N` with `updated_at = NOW()` (raw SQL bypasses Prisma's
  `@updatedAt`, and terminals pull via an `updatedAfter` cursor) plus a `store_id` guard. The old
  read-then-write also raced concurrent sale sync. `syncSale` and the one-shot
  `unbackfillStock` repair now use the same `toPieces()` helper, so the paths cannot drift apart
  again. The SALE_REVERSAL movement records the corrected piece figure.
- **Verified `pg_dump` of `posgro`** before anything reaches production.
- **Enable the flag** and seed `OPENING` (`POST /reconciliation/seed-opening`, idempotent) —
  staging first.
- No live run: the UI has not been opened, and no reconciliation has executed against a real
  database.
