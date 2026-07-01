# MXIK / IKPU Integration Guide
### Grocery POS — Electron + NestJS + Prisma

---

## What Is MXIK and Why Do You Need It

MXIK (МХИК) — also called IKPU — is Uzbekistan's national product classification code from `tasnif.soliq.uz`. Every product sold through a fiscal cash register must have one. Without it, OFD (fiscal data operator) receipts are invalid.

**No API key or government registration required** for `tasnif.soliq.uz`.

**Geo-restriction:** `tasnif.soliq.uz` is only reachable from Uzbekistan IP addresses.
- `mxik.searchByBarcode` → called from the **browser** (user is in UZ) ✅
- `mxik.lookupCode` → proxied through the **VPS server** ✅

---

## Architecture Overview

```
Web dashboard (browser in UZ)
└── mxik.searchByBarcode(barcode)
        └── GET tasnif.soliq.uz/api/cls-api/elasticsearch/search  ← browser, direct
        └── GET tasnif.soliq.uz/api/cls-api/integration-mxik/get/history/:mxikCode

└── mxik.lookupCode(mxikCode)
        └── GET /api/mxik/code/:code  ← axiosInstance → VPS server
                └── MxikController → MxikService
                        └── GET tasnif.soliq.uz/api/cls-api/integration-mxik/get/history/:code
```

**There is no `mxik` npm package in use.** Both client and server call the `tasnif.soliq.uz` REST API directly via `fetch`.

---

## Server-Side Module

### MxikController
`src/server/modules/mxik/mxik.controller.ts`

```
GET /api/mxik/code/:code      → look up by 17-digit MXIK code
GET /api/mxik/search/:barcode → find MXIK by product barcode (EAN-13)
```

Both endpoints require `JwtAuthGuard + RolesGuard`, roles: `ADMIN` or `SUPER_ADMIN`.

**Note:** The controller route for barcode search is `GET /mxik/search/:barcode` (path param), **not** `GET /mxik/search?q=` (query param). The web app does not call this server endpoint — it calls tasnif directly from the browser.

### MxikService
`src/server/modules/mxik/mxik.service.ts`

Uses `fetch` against `https://tasnif.soliq.uz/api/cls-api`:

**`getByCode(code)`**
- Validates 17-digit format
- `GET /integration-mxik/get/history/:code`
- Returns `{ code, name (UZ), nameRu, packageCode }`
- `packageCode` defaults to `'796'` (piece) if none returned

**`searchByBarcode(barcode)`**
- `GET /elasticsearch/search?lang=uz_cyrl&search=:barcode&size=5&page=0`
- Prefers exact `internationalCode` match, falls back to first result
- Calls `getByCode` on the matched MXIK code
- Returns same shape as `getByCode`

---

## Client-Side Functions (src/web/src/api/client.ts)

### `mxik.lookupCode(code)`
- `GET /api/mxik/code/:code` via `axiosInstance` (JWT included)
- Used when a 17-digit MXIK QR is scanned (routes through VPS)
- Returns `{ code, name, nameRu, packageCode }`

### `mxik.searchByBarcode(barcode)`
- **Calls `tasnif.soliq.uz` directly from the browser** (geo-restriction: must run in UZ)
- Two-step: elasticsearch search → get/history detail
- Returns `{ code, name, nameRu, packageCode }`
- Throws on not-found (caller wraps in try/catch)

### `mxik.lookupBatch(codes[])`
- Browser-direct to tasnif, uses `by-params` endpoint
- Returns `Record<string, MxikScanInfo>` — a map of code → info
- Used for bulk auto-fill on the product list
- Each call has a 6-second `AbortSignal` timeout

---

## Where MXIK Is Used in the Scan Flow

### handleFabScan (ProductList.tsx)

| QR Type | MXIK action |
|---------|-------------|
| `datamatrix` | `mxik.searchByBarcode(gtin)` — browser direct to tasnif |
| `mxik` (17-digit) | Sets `initial.mxik = qrData` only — no tasnif call |
| `barcode` | `mxik.searchByBarcode(barcode)` — browser direct to tasnif |
| `fiscal` | No MXIK lookup |

For `datamatrix` and `barcode` types, the lookup populates:
- `initial.mxik` ← `result.code`
- `initial.nameRu` ← `result.nameRu`
- `initial.nameUz` ← `result.name`
- `initial.packageCode` ← `result.packageCode`

Failures are silently caught — form opens with whatever data was found.

### handleAutoFillMxik (ProductList.tsx)

Bulk-assigns MXIK to all products that don't have one:
- Iterates products without `mxik`
- Calls `mxikApi.searchByBarcode(product.barcode)` for each
- Calls `productsApi.update(id, { mxik: result.code })` on success
- 300ms delay between requests to avoid rate-limiting tasnif

---

## Prisma Schema Fields

The `Product` model uses a single `mxik` field (not `mxikCode`/`mxikName`/`packageCode` as in older docs):

```prisma
model Product {
  mxik        String?   // 17-digit MXIK/IKPU code, e.g. "06111001018000000"
  packageCode String?   // OFD package code, e.g. "796" (piece), "166" (kg)
  // nameRu, nameUz store the product names (not a separate mxikName field)
}
```

There is **no `mxikName` field** in the current schema — product names are stored in `nameRu`/`nameUz` directly.

---

## OFD Sale Payload

Each sale item sent to the fiscal operator includes:

```typescript
interface OfdSaleItem {
  productName:     string   // nameRu or nameUz
  productCode:     string   // mxik — e.g. "06111001018000000"
  packageCode:     string   // e.g. "796" (piece), "166" (kg)
  productBarCode:  string
  productQuantity: number
  price:           number   // in UZS
  sumPrice:        number
  vat:             number
  vatPercent:      number   // 0 or 12
}
```

---

## Quick Reference

| Thing | Value |
|-------|-------|
| tasnif base URL | `https://tasnif.soliq.uz/api/cls-api` |
| API key needed? | No |
| npm package? | No — uses `fetch` directly |
| MXIK code format | 17-digit string, e.g. `06111001018000000` |
| Geo-blocked? | Yes — browser calls work (user in UZ); server calls may fail |
| `searchByBarcode` called from | Browser (web dashboard) |
| `lookupCode` called from | Server (via `/api/mxik/code/:code`) |
| DB field name | `mxik` (not `mxikCode`) |
| Package code "796" | Piece (шт) |
| Package code "166" | Kilogram (кг) |
| Package code "111" | Litre (л) |

---

## Troubleshooting

**`tasnif.soliq.uz` returns empty results**
→ Product not in MXIK registry, or site has downtime. Scan flow silently continues with whatever data was found. User can enter MXIK manually.

**Server-side `searchByBarcode` fails (VPS geo-blocked)**
→ The server endpoint `/api/mxik/search/:barcode` exists but may fail from the VPS. The web app deliberately uses browser-direct calls (`mxik.searchByBarcode`) to avoid this.

**Auto-fill stops mid-way**
→ User may have clicked Stop, or tasnif had a timeout. Progress state shows `running: false` when done or aborted.

**OFD rejects the receipt**
→ Verify `packageCode` matches unit type: piece=`796`, kg=`166`, litre=`111`.

**MXIK not syncing to SQLite terminals**
→ Check that `products-sync.ts` includes `mxik` and `packageCode` in the upsert fields.

Request URL
https://tasnif.soliq.uz/api/cls-api/elasticsearch/search?lang=uz_cyrl&search=01806001008016007&size=20&page=0
Request Method
GET
Status Code
200 OK
Remote Address
109.207.242.14:443
Referrer Policy
strict-origin-when-cross-origin

Response:
{
    "success": true,
    "code": 200,
    "reason": "success",
    "data": [
        {
            "mxikCode": "01806001008016007",
            "name": "Плиткали шоколад: Победа, Пористый, сутли  180 гр фл/п",
            "description": "1126",
            "internationalCode": "4607005401243",
            "label": "0",
            "fullName": "ПЛИТКАЛИ ШОКОЛАД ПОБЕДА ПОРИСТЫЙ, СУТЛИ  180 ГР ФЛ/П ШОКОЛАД ПЛИТОЧНЫЙ ПОБЕДА ПОРИСТЫЙ МОЛОЧНЫЙ ПЛИТОЧНЫЙ 180 ГР ФЛ/П PLITKALI SHOKOLAD ПОБЕДА PORISTЫY, SUTLI  180 GR FL/P 01806001008016007 4607005401243",
            "groupCode": "018",
            "groupName": "КАКАО ВА УНИНГ МАҲСУЛОТЛАРИ",
            "classCode": "01806",
            "className": "Таркибида какао бўлган шоколад ва бошқа озиқ-овқат маҳсулотлари",
            "positionCode": "01806001",
            "positionName": "Шоколад ва шоколад маҳсулотлари",
            "subPositionCode": "01806001008",
            "subPositionName": "Плиткали шоколад",
            "brandCode": "01806001008016",
            "brandName": "Победа",
            "attributeName": "Пористый, сутли  180 гр фл/п",
            "usePackage": "1",
            "categoryUnitId": null,
            "categoryUnitName": null,
            "unitsName": "шт (пакет) 180 грамм",
            "surveyCategoryId": "54",
            "nonChangeable": "1",
            "lgotaId": null,
            "lgotaName": null,
            "recommendedCategoryUnitName": null,
            "recommendedUnitsName": null,
            "packageName": null,
            "useCard": "0",
            "property": null,
            "categoryCode": "7",
            "categoryName": "Озиқ-овқат маҳсулотлари",
            "mnnName": null
        }
    ],
    "recordTotal": 1,
    "errors": null
}
Request URL
https://tasnif.soliq.uz/api/cls-api/mxik/search/by-params?mxikCode=01806001008016007&size=15&page=0&lang=uz_cyrl
Request Method
GET
Status Code
200 OK
Remote Address
109.207.242.14:443
Referrer Policy
strict-origin-when-cross-origin

Response:
{
    "success": true,
    "code": 200,
    "reason": "OK",
    "data": {
        "content": [
            {
                "groupCode": "018",
                "classCode": "01806",
                "positionCode": "01806001",
                "subPositionCode": "01806001008",
                "brandCode": "01806001008016",
                "mxikCode": "01806001008016007",
                "unitCode": null,
                "commonUnitCode": null,
                "groupName": "КАКАО ВА УНИНГ МАҲСУЛОТЛАРИ",
                "className": "Таркибида какао бўлган шоколад ва бошқа озиқ-овқат маҳсулотлари",
                "positionName": "Шоколад ва шоколад маҳсулотлари",
                "subPositionName": "Плиткали шоколад",
                "brandName": "Победа",
                "mxikName": "Плиткали шоколад: Победа, Пористый, сутли  180 гр фл/п",
                "unitName": null,
                "commonUnitName": null,
                "attributeName": "Пористый, сутли  180 гр фл/п",
                "internationalCode": "4607005401243",
                "myProduct": 0,
                "label": 0,
                "packages": null,
                "units": null
            }
        ],
        "pageable": {
            "sort": {
                "unsorted": true,
                "sorted": false,
                "empty": true
            },
            "pageSize": 15,
            "pageNumber": 0,
            "offset": 0,
            "unpaged": false,
            "paged": true
        },
        "last": true,
        "totalPages": 1,
        "totalElements": 1,
        "sort": {
            "unsorted": true,
            "sorted": false,
            "empty": true
        },
        "first": true,
        "numberOfElements": 1,
        "size": 15,
        "number": 0,
        "empty": false
    },
    "errors": null
}

no product found response:
{
    "success": true,
    "code": 200,
    "reason": "OK",
    "data": {
        "content": [],
        "pageable": {
            "sort": {
                "sorted": false,
                "unsorted": true,
                "empty": true
            },
            "pageNumber": 0,
            "pageSize": 15,
            "offset": 0,
            "paged": true,
            "unpaged": false
        },
        "last": true,
        "totalElements": 0,
        "totalPages": 0,
        "sort": {
            "sorted": false,
            "unsorted": true,
            "empty": true
        },
        "first": true,
        "numberOfElements": 0,
        "size": 15,
        "number": 0,
        "empty": true
    },
    "errors": null
}
---

## Backfilling `Product.isMarked` (Asl-Belgisi marking flag)

`Product.isMarked` is the authoritative mandatory-marking flag, sourced from tasnif's per-product `label` (`1` = marked, `0` = plain). It replaces the old MXIK group-020/022 prefix heuristic (which was wrong both ways). The POS uses `productRequiresMarking(product)` = `isMarked ?? isMarkedMxik(mxik)` (`src/shared/utils/marking.ts`), so rows left `NULL` fall back to the heuristic.

`scripts/backfill-is-marked.ts` fills the column for existing products. tasnif is geo-blocked to Uzbekistan IPs and the VPS is in Germany, so the script **runs on a UZ machine** and writes to the VPS Postgres **over an SSH tunnel**.

**Prerequisite:** the `is_marked` column must exist on the target DB (migration `20260701000001_add_product_is_marked`). It is applied by the normal `prisma migrate deploy` on deploy — or apply it yourself over the tunnel (Step 2b).

### Steps (production)

1. **Open the tunnel** — leave this terminal open (local `5433` → VPS Postgres `5432`, which docker publishes on `127.0.0.1:5432`):
   ```
   ssh -L 5433:localhost:5432 bobur@144.91.121.160
   ```

2. **Point `DATABASE_URL` at the tunnel** in a second terminal (repo dir). Take USER/PASS from the VPS `.env` `DATABASE_URL`, but swap the host for `localhost:5433`:
   - PowerShell: `$env:DATABASE_URL = "postgresql://USER:PASS@localhost:5433/posgro"`
   - Git Bash:   prefix each command with `DATABASE_URL="postgresql://USER:PASS@localhost:5433/posgro"`

   2b. *(only if the column isn't deployed yet)* apply the migration over the tunnel:
   ```
   npx prisma migrate deploy
   ```

3. **Dry run** — reports counts, writes nothing:
   ```powershell
   $env:DRY_RUN = "true"
   npx tsx scripts/backfill-is-marked.ts
   ```

4. **Real run:**
   ```powershell
   Remove-Item Env:DRY_RUN
   npx tsx scripts/backfill-is-marked.ts
   ```

5. **Verify** a few known cases (e.g. `npx prisma studio`): plain goods (Bonduelle corn, Lays) → `is_marked = false`; marked goods (Qaymoq, Baranki) → `is_marked = true`.

Tunables (env): `DRY_RUN`, `ONLY_NULL=true` (only touch `NULL` rows), `DELAY_MS` (tasnif throttle, default 200), `STORE_ID`, `LANG`. Re-runnable / idempotent. Non-17-digit or unknown-to-tasnif MXIK stay `NULL`. Terminals pick up `is_marked` on their next product sync (local SQLite column added by `runMigrations` on app start).

**Staging first:** same steps against `posgro_staging` — check `docker-compose.staging.yml` for its Postgres host port and tunnel to that instead.

Diagnostic probes (read-only, no DB writes): `scripts/check-mxik-label.ts` and `scripts/check-mxik-false-positives.ts` compare tasnif `label` against the old group heuristic over `products.json`.

---

*Last Updated: 2026-07-01 — added Product.isMarked backfill section*
