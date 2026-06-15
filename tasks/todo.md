# Per-product VAT + duplicate-code recovery

## Goal
1. **Per-product VAT** — replace the single global `vatPercent` (applied to every position) with a
   per-product `vatRate` (percent, nullable → falls back to the global default). Fixes mixed-rate
   catalogs (0% staples vs 12% goods) failing `Receipt.Sale` with `701003 «Ставка НДС не найдена»`.
2. **Duplicate-code recovery** — when a `Receipt.Sale` registers on the VCR but the response is lost
   (or a retry hits the uniqueness guard), recover the fiscal data via `Receipt.GetInfo(Code)` instead
   of orphaning a fiscalized receipt as FAILED locally.

## Design
- `vatRate Int? @map("vat_rate")` on Product (both schemas). Null = use global `regos_vcr_vat`.
- Fiscal: `rate = product?.vatRate ?? cfg.vatPercent`.
- Recovery: on any non-network (business) error during fiscalize, query `getReceiptInfo({ Code: sale.id })`;
  if a receipt exists, persist it FISCALIZED; else fall through to FAILED. Self-correcting, no error-code guessing.

## Tasks
### Per-product VAT
- [ ] `prisma/schema.prisma` — add `vatRate Int? @map("vat_rate")` to Product
- [ ] `prisma/schema.sqlite.prisma` — add same
- [ ] `src/shared/types/product.types.ts` — add `vatRate?` to Product / ProductCreateInput / ProductUpdateInput
- [ ] `src/server/.../dto/create-product.dto.ts` + `update-product.dto.ts` — add vatRate (optional int 0..100)
- [ ] `src/server/.../products.service.ts` — create() maps vatRate (update auto via ...rest)
- [ ] `src/main/sync/products-sync.ts` — pull vatRate (create + 2 update branches)
- [ ] `src/main/ipc/products-handlers.ts` — serializeProduct + create + update
- [ ] `src/web/.../ProductForm.tsx` — VAT field (state, init, submit, UI)
- [ ] `src/main/fiscal/regos-vcr-service.ts` — use per-product rate

### Duplicate-code recovery
- [ ] `src/main/fiscal/regos-vcr-service.ts` — getReceiptInfo(Code) recovery in fiscalize catch

### Migrations / build
- [ ] sqlite: `prisma db push --schema prisma/schema.sqlite.prisma` + generate:sqlite
- [ ] PG: create migration (deploys on staging per workflow) + `prisma generate`
- [ ] typecheck / lint
- [ ] NO electron version bump (per user)

## Review
Done. Per-product VAT + duplicate-code recovery implemented end-to-end.

**Per-product VAT** (`vatRate`, nullable percent → falls back to global `regos_vcr_vat`):
- Both Prisma schemas + PG migration `20260615000001_add_product_vat_rate` + SQLite runtime
  Migration 24 in `sqlite-client.ts` (existing terminal DBs get the column on next launch).
- Shared `Product` / create / update types; server create DTO + update DTO + `create()` mapping
  (update auto via `...rest`); product pull-sync (create + both update branches); local IPC
  serialize/create/update; web `ProductForm` (state/init/submit/UI select 0/12/default) + ru/uz keys.
- Fiscal `buildPositions`: `rate = product?.vatRate ?? cfg.vatPercent`.

**Duplicate-code recovery** (`regos-vcr-service.ts`): on a business-level fiscalize failure, look up
the receipt by our `code` (= sale.id) via `Receipt.GetInfo`; if a fiscalized receipt exists, adopt it
as FISCALIZED instead of marking FAILED. Network errors still stay PENDING; validation failures return
null and fall through to FAILED. New `tryRecoverByCode` helper.

**Verification:** typecheck clean on all 3 tsconfigs (root / server / web, 0 errors); Jest passes;
both Prisma clients regenerated. Repo `npm run lint` is non-functional (no eslint.config.js for eslint v9)
— pre-existing, unrelated. Electron version NOT bumped (per request).

**Deploy notes:** server/web change → push `dev`, staging runs `prisma migrate deploy` (applies the new
migration to `posgro_staging`), verify, then merge to `main`. Electron change ships when you next bump +
`npm run deploy:pos`. Admins set VAT per product in the web product form; unset = global default (unchanged behaviour).
