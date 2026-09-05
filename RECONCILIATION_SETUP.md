# POSGRO — Stock & Money Reconciliation + Movement Ledger Setup

> **This is a PLANNING brief for Claude Code, not an implementation spec.**
> Enter `/plan` mode, **analyze the actual codebase first**, ask the open questions in §10,
> and produce a written plan **before writing any code**. Do not guess. Do not trust the docs
> over the real files.

---

## 0. Prime directive (non-negotiable)

There is **one live store running in ONLINE mode.** Nothing here may break it.

- All schema changes **additive and reversible** (nullable → backfill → tighten). No dropped
  columns/models, no touched Postgres volume without a verified backup.
- This is a **web/admin, store-scoped** feature (`storeId`). It must **not** appear on the
  Electron cashier terminal, and in online mode it reads **server-authoritative** data — same
  boundary as `StockManagement`.
- Reconciliation must be **read-only over existing data** wherever possible. The only writes it
  introduces are new ledger rows and stocktake adjustment rows — it must never silently mutate
  historical sales or arrivals.

---

## 1. Objective

Build the calculation that answers: *"A month passed. If nothing was stolen, lost, or
mis-recorded, does everything reconcile to zero?"*

Deliver it as **two independent reconciliations that never share a zero-check:**

1. **Goods reconciliation** (inventarizatsiya) — per-SKU, in **quantities**. Answers whether
   physical stock matches what the movements say it should be. **Shrinkage / theft lives here.**
2. **Money reconciliation** — cash + card (+ debts later) vs total sales. Answers whether the
   drawer matches what was sold. **Debts (nasiya) live here, and only here.**

A credit sale removes goods exactly like a cash sale, so a debt is **already inside "sales"** in
the goods equation and must **not** be subtracted again there. Debt only explains why the drawer
is smaller than sales. Keep the two calculations structurally separate — separate services,
separate reports, separate variances.

**Current reality (from the user):** the app does **not** yet track customer debts (nasiya) or
damage/expiry write-offs. There **is** an existing write-off mechanism tied to stocktake (it
writes off products *not included* in a selected stocktake run). Debts and damage/expiry
write-offs will be added later — this design must leave clean seams for both without a rewrite.

---

## 2. What Claude Code must analyze before planning

Enter `/plan`. Read the real code and report:

1. **Prisma models** touching stock: `Product` (and its `stock`, `cost`, `price` fields, and the
   real ID types), `InventoryArrival`, `Sale`, `SaleItem`, the `inventory-count` module's models,
   and anything that currently mutates `Product.stock`.
2. **Every write path to `Product.stock`** — arrivals, sales, the existing stocktake write-off,
   any manual adjustment, any sync-driven increment/decrement. List each and whether it's atomic.
3. **The existing stocktake write-off** — its exact semantics: what "products not included in the
   selected stocktake" means, when it fires, what it writes, and whether it already produces an
   auditable record or just decrements `stock`. **This is critical — do not guess (§10 Q1).**
4. **Payment data on `Sale`** — is it only `paymentMethod` (cash/card), or is there any split /
   partial-payment / change-given data? This bounds what money reconciliation can do today.
5. **The `inventory-count` module** — how a count is created, scoped (all products? selection?
   category?), stored, and finalized today, and the still-open absolute-set vs delta decision.
6. **`storeId` / branch scoping** status — whether the multi-store work has landed, so this
   feature scopes correctly per store.

Output findings first, flag every contradiction with this brief or the docs.

---

## 3. Core model: a movement ledger as source of truth

Aggregate retail-value reconciliation breaks whenever a price changes mid-period. Reconcile
**per SKU in quantities** (immune to re-pricing) and value the result only at the end.

Introduce a single append-only **StockMovement** ledger. Every event that changes on-hand
quantity becomes one typed row. Proposed movement types (Claude Code confirms/renames against
existing conventions):

| Type | Qty sign | Exists today? | Notes |
|---|---|---|---|
| `OPENING` | + | no | Defined start of a period / new-store opening balance (the "$50,000") |
| `ARRIVAL` | + | yes (`InventoryArrival`) | Wrap/emit from existing arrivals, don't duplicate |
| `SALE` | − | yes (`SaleItem`) | Includes cash, card, **and future nasiya** — all of them |
| `CUSTOMER_RETURN` | + | maybe | If returns exist |
| `SUPPLIER_RETURN` | − | maybe | If returns exist |
| `STOCKTAKE_WRITE_OFF` | − | **yes** | The existing "not-included in stocktake" write-off — must map to a real ledger type, not stay hidden |
| `STOCKTAKE_ADJUSTMENT` | ± | partly | Variance correction on finalize (§8) |
| `WRITE_OFF_DAMAGE` / `WRITE_OFF_EXPIRY` | − | **no — later** | Reserve the type now; feature added later |
| `REVALUATION` | 0 | no | Price change only, qty unchanged — for reporting, not the qty equation |

The ledger must store, per row: product, store, type, quantity delta, a **cost snapshot** and a
**sale-price snapshot** at event time, a reason/reference (source arrival id, sale id, stocktake
id), actor, and timestamp. Snapshots are what let you value variance later without the
re-pricing trap.

---

## 4. Goods reconciliation (per SKU, quantities)

Per product, per store, for `[periodStart, periodEnd]`:

```
Book qty = Σ OPENING + Σ ARRIVAL + Σ CUSTOMER_RETURN
         − Σ SALE − Σ SUPPLIER_RETURN
         − Σ STOCKTAKE_WRITE_OFF − Σ WRITE_OFF_* (when they exist)
         ± Σ STOCKTAKE_ADJUSTMENT (from prior finalized counts in range)

Variance qty = Book qty − Physical count qty
```

- `Variance = 0` → clean.
- `Variance > 0` (kamomad / shortage) → theft, unrecorded breakage, unrecorded sale,
  over-stated receiving, or miscount.
- `Variance < 0` (излишек / surplus) → unrecorded arrival, over-count, or data error.

**Mandatory cross-check (bug detector, not shrinkage):** compute book qty **two ways** and expect
them to match —
1. **Perpetual:** current `Product.stock`.
2. **Recomputed:** the ledger sum above.

If perpetual ≠ recomputed, it's an app/data/sync bug (e.g. a decrement that didn't fire), **not**
theft. Surface this separately so the user never chases a phantom shortage caused by a code bug.

**Valuation (applied after the qty math):** value `Variance qty` at **cost snapshot** →
financial loss; at **sale-price snapshot** → retail impact. Sum across products for the store
total. Cost method (weighted average / last cost / FIFO) is an open question — see §10 Q4.

The retail-value summary you described (opening 50,000 + arrivals − sales − write-offs = expected
closing) is produced **on top of** this as a management view, reconciling to zero **only because**
every price change is captured as a `REVALUATION` row. The per-SKU quantity engine is the
authority; the retail table is the readout.

---

## 5. Money reconciliation (separate, debts later)

Independent service, same period, same store:

```
Total sales = Cash collected + Card collected + New debts (nasiya) + Discounts given
⇒ Expected (cash + card) = Total sales − nasiya − discounts
Cash variance = Expected (cash + card) − Actually collected
```

- **Today:** with no debt tracking, treat `nasiya = 0` and reconcile `cash + card` (split by
  `paymentMethod`) against total sales, minus discounts if discount data exists.
- **Later:** when the debt feature lands, money reconciliation reads outstanding/new debts and
  the formula is already correct — no restructuring.
- A cash shortage here is a **register/cashier** issue, wholly separate from a goods shortage in
  §4. Never net one against the other.

Design this as its own module/report from day one so debts plug in without touching goods logic.

---

## 6. Reconciling with the existing stocktake write-off

The current app already writes off products "not included in a selected stocktake." This produces
stock changes the reconciliation **must** account for, and it interacts directly with finalization.

Claude Code must, in the plan:
- Document the exact current behavior (§2.3) and decide whether it is retained, replaced, or
  reframed as an explicit `STOCKTAKE_WRITE_OFF` ledger type.
- Ensure that whatever it does today becomes an **auditable ledger row** going forward, so it
  shows up in the goods equation instead of silently moving `Product.stock`.
- Clarify partial vs full counts: if a count is scoped to a selection, define precisely what
  happens to unselected products (untouched? written off? carried at book?) — this must not stay
  implicit (§10 Q1, Q5).

---

## 7. Forward-compatibility seams (added later)

Design so these drop in without a rewrite:
- **Debts (nasiya):** future `Debt`/customer-ledger model + a payment allocation on `Sale`.
  Money reconciliation (§5) already references it; goods reconciliation ignores it (debt sales
  are already `SALE` movements).
- **Damage/expiry write-offs:** future explicit `WRITE_OFF_DAMAGE` / `WRITE_OFF_EXPIRY`
  movements with reason codes. The ledger type slots (§3) are reserved now; §4's equation already
  subtracts them.

Neither feature should require changing the reconciliation engine — only supplying data it
already knows how to consume.

---

## 8. Stocktake finalization

On finalizing a count, for each product, do **both in order** (resolves the open absolute-vs-delta
decision):
1. Write a `STOCKTAKE_ADJUSTMENT` movement = `counted − book`, with a reason code. Preserves the
   variance permanently in the ledger.
2. Set `Product.stock = counted`. Corrects the perpetual book.

Absolute-set alone erases the evidence; delta alone leaves the book wrong. Logging the delta then
setting absolute gives a corrected book **and** a permanent, reportable shrinkage record (per
period, per store, per cashier).

---

## 9. Migration & live-store safety

- New `StockMovement` ledger + new movement-type enum, added **additively**.
- **Backfill question (Q3):** whether to reconstruct history by emitting `OPENING` + `ARRIVAL` +
  `SALE` rows from existing `InventoryArrival`/`SaleItem`, or to start the ledger fresh from a
  dated `OPENING` snapshot per product. Fresh-start is safer for the live store; historical
  backfill is more complete but riskier.
- Existing arrivals/sales writers should **emit** ledger rows going forward (wrap, don't
  duplicate). Confirm each write path is transactional so `Product.stock` and the ledger can't
  diverge.
- Ship behind a flag; the reconciliation UI is read-only and store-scoped, so it can be enabled
  on the live store with minimal risk once the cross-check (§4) passes on real data.

---

## 10. Questions Claude Code MUST ask before coding

Present with a recommended default; wait for answers.

**Q1 — Existing stocktake write-off semantics.** What exactly does the current "write off products
not included in the selected stocktake" do, when, and what does it record? *No default — this must
be established from the code and confirmed with the user before anything is built on top of it.*

**Q2 — Payment data available today.** Is `Sale` only `paymentMethod` (cash/card), or is there
any split/partial/discount data? This sets how far money reconciliation can go now.

**Q3 — Ledger backfill vs fresh start.** Reconstruct history from existing arrivals/sales, or
start the ledger from a dated `OPENING` snapshot per product? *Recommended: fresh `OPENING`
snapshot for the live store (safe), with historical backfill as an optional later pass.*

**Q4 — Cost basis for valuing variance.** Weighted average, last cost, or FIFO? `Product.cost`
looks like a single field, implying last/standard cost. *Recommended: weighted-average cost held
per product, snapshotted onto each movement; confirm.*

**Q5 — Partial vs full stocktake.** How are unselected products handled in a scoped count
(untouched / written off / carried at book)? Tie the answer to Q1.

**Q6 — Period definition.** Calendar month, or arbitrary start/end per store? *Recommended:
arbitrary range, defaulting to "since last finalized stocktake."*

**Q7 — Opening balance entry.** How is a new store's initial stock (the "$50,000") entered — as
`OPENING` movements per product, or as arrivals? *Recommended: dedicated `OPENING` type so it's
distinguishable from purchases.*

**Q8 — Finalization confirmation.** Confirm the log-delta-then-set-absolute approach in §8, and
whether variance reason codes (theft / breakage / miscount / expiry) are required on finalize.

---

## 11. Deliverables from `/plan` mode (before any code)

1. Codebase findings (§2), contradictions flagged, and a written account of the current stocktake
   write-off (Q1).
2. Confirmed `StockMovement` ledger design — types, snapshot fields, and how existing arrivals /
   sales / stocktake write-offs emit into it without duplication.
3. **Two separate** reconciliation designs: goods (per-SKU qty engine + perpetual-vs-recomputed
   cross-check + valuation) and money (cash/card now, debt-ready).
4. Finalization design (§8) resolving absolute-vs-delta.
5. Forward-compatibility seams for debts and damage/expiry write-offs (§7).
6. Additive/reversible migration + backfill plan and live-store safety steps (§9).
7. Q1–Q8 answered with the user.

Only after approval, leave `/plan` mode and implement — web/admin only, `storeId`-scoped,
server-authoritative in online mode, NestJS `RolesGuard`/`@Roles(ADMIN)`, RU/UZ i18n keys on
every new string, existing Prisma conventions.
