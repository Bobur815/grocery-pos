# Task — Subscription status + payment QR on the login screen

Add two buttons to `src/renderer/pages/Login/TerminalAccessBar.tsx`:
1. **Subscription status** — plan, expiry date, AI plan, store balance.
2. **Pay subscription** — a scannable UzQR for a bank transfer plus a self-service
   Click/Payme/Paynet link (modelled on `~/Pictures/pay_qrcode.png`).

The login screen is unauthenticated, so the data comes from the VPS token the terminal already
keeps across logouts (the same credential `receipt:getPlan` uses), and is cached locally so the
dialog still shows something offline.

## Steps

### Server
- [x] `site-config.service.ts` — `SubscriptionPayment` ({ qrPayload, paymentUrl, supportPhone })
      stored under the `subscription_payment` siteConfig key, with getter + setter.
- [x] `site-config.controller.ts` — public GET / super-admin PUT `subscription-payment`.
- [x] `site-config.module.ts` — export `SiteConfigService`; `stores.module.ts` imports it.
- [x] `store-config.controller.ts` — `GET /store-config/subscription` returning the current
      store's plan, expiry, aiPlan and balance plus the payment block ({storeId} substituted).

### Electron main
- [x] `src/main/ipc/subscription-handlers.ts` — `subscription:get` (live fetch → cache →
      offline fallback, QR rendered locally) and `subscription:openPaymentLink`.
- [x] Register in `handlers.ts`; expose via `preload.ts`.

### Renderer
- [x] `TerminalAccessBar.tsx` — CreditCard button → status dialog → payment dialog.
- [x] i18n keys in `ru.json` / `uz.json` under the existing `subscription` namespace.

### Web dashboard
- [x] `client.ts` + `SubscriptionPlansPage.tsx` — a card for the super admin to set the QR
      payload, payment link and support phone (without it the POS dialog has nothing to show).

## Review

Done. Two buttons on the login screen, both hidden for an OFFLINE_ONLY store:

- **Card icon → subscription status.** Plan, expiry date, AI plan and store balance. An expired
  date is shown in the error colour; a plan with no expiry reads as "perpetual" (VIP).
- **Pay button inside it → payment dialog.** Bank-transfer QR, the call-centre instruction and
  phone, then the Click/Payme/Paynet link, in the order the reference screenshot uses.

Design notes worth keeping:

- The login screen is unauthenticated, so `subscription:get` reuses the VPS token the terminal
  keeps from the last password login. `getServerToken()` is only armed by a login, so on a cold
  start the handler falls back to reading the persisted `server_token` row — a read of the
  store's own billing state, so it deliberately does not re-arm the global token from there.
- Every reply is cached in the `store_subscription` system setting with the QR already rendered.
  Offline, the dialog shows the last known figures and says so, rather than going blank.
- The QR is generated on the terminal from a payload string, not fetched as an image, so the
  payment dialog works with no network.
- The pay link is re-validated as http(s) in the main process before `shell.openExternal` — the
  URL comes from the server and must not be able to launch a local file or custom protocol.
- The super admin sets the payload, link and phone on the existing Subscription Plans page;
  without that config the Pay button stays disabled instead of opening an empty dialog.

Verified: `tsc --noEmit` clean on both tsconfigs (0 errors), `nest build` clean,
`electron-vite build` clean, 149/149 jest tests pass.

Not done: `npm run lint` cannot run in this repo — ESLint 9 finds no `eslint.config.js` (the
project still has the v8 `.eslintrc` format). Pre-existing, unrelated to this change.

The version in `package.json` was left at 1.26.1 — per the standing convention it gets bumped
once at deploy time, not per change.

---

# Follow-up — OFFLINE_ONLY must not lose these buttons

Both buttons were hidden for an OFFLINE_ONLY store on the reasoning that it "has no server, so
there is no dashboard to point at". Wrong twice over: such a store still has a subscription with
the vendor, and its dashboard does not need the VPS — the data is already in the terminal's
SQLite, so the terminal can serve it on the shop's own Wi-Fi.

Agreed to land in two steps. **Step 1 is done** (below). Step 2 — the embedded LAN server — is
designed in the approved plan and will be built and reviewed on its own.

## Step 1 — done

- [x] `src/main/network/lan-address.ts` — rank this machine's IPv4 addresses, best first. Private
      ranges in shop-LAN order, and virtual adapters (VirtualBox / WSL / Docker / Hyper-V /
      Tailscale) demoted below every real one, because the OS may well list one of those first and
      a phone cannot reach it.
- [x] `config:getWebAdminQr` no longer returns null for OFFLINE_ONLY. It returns
      `http://<lan-ip>:<port>/web/` instead, where port is the `local_web_port` system setting,
      defaulting to 5173 — the port `cd src/web && npm run dev` already uses. The reply gained a
      `local` flag so the renderer picks its wording from the payload rather than re-reading mode.
- [x] `app:isOnline` takes an optional URL, defaulting to today's hardcoded production host, so
      existing callers are unaffected and the subscription button can probe the server this
      terminal is actually configured against.
- [x] `TerminalAccessBar.tsx` — all three buttons always render. The subscription button probes
      first and raises the existing `errors.noInternet` toast instead of opening a dialog of
      dashes. The QR dialog explains a LAN address differently from a hosted one, and says so when
      there is no address at all.
- [x] `settings.webAdminLocalHint` / `settings.webAdminUnavailable` in ru + uz.
- [x] `src/main/network/lan-address.test.ts` — 10 cases over the ranking rules.

Verified: `tsc --noEmit` 0 errors, `electron-vite build` clean, 159/159 jest tests pass (149
before, +10 new). Ran the real `getLanAddress()` against this machine's interfaces: it returns
`192.168.1.7`, the same address `npm run dev` reports, so the QR matches the workflow it replaces.

Still not verified by me: scanning the QR from an actual phone.

## Step 2 — done: the terminal serves the dashboard on the shop LAN

An OFFLINE_ONLY terminal now runs an HTTP server on `0.0.0.0:5173` serving the built dashboard at
`/web/` and a local `/api` backed by its own SQLite. New module `src/main/local-server/`.

### Shape of the thing

- `index.ts` lifecycle + request dispatch, `router.ts`, `auth.ts`, `static-files.ts`,
  `helpers.ts`, `stocktake-plan.ts`, and `routes/` (one file per NestJS controller mirrored).
- Started only for an OFFLINE_ONLY store, from `launchMainApp()`, and re-evaluated whenever a
  sync cycle reports a changed mode — so flipping a store either way needs no restart. Closed on
  quit. A failure to bind is recorded and shown in the QR dialog, never thrown into startup.
- `config:getWebAdminQr` now points at the address the listener actually came up on.

### The decision that shaped every route

**Mirror the NestJS service, not the Electron IPC handler.** The IPC handlers run
`serializeProduct()` — Decimals to numbers, `active` renamed to `isActive`, nulls dropped — which
is the POS renderer's convention. The dashboard was built against the server's raw Prisma rows.
Returning raw rows gets this right for free, since a Prisma `Decimal` serializes to a JSON string
on both providers. There is a test asserting exactly this (`active` present, `isActive` absent,
`price` a string).

### Full parity, and where it genuinely stops

Served properly: auth, products, categories, sales, users, settings, inventory arrivals,
low-stock, suppliers + transactions, analytics, stocktake, money reconciliation, store identity,
site config, invoice line matching, MXIK code proxy, marking-code verification.

- **Stocktake** needed new local tables — `inventory_counts` / `inventory_count_items` are
  web-only on the VPS. Added to the SQLite schema *and* to the hand-written schema in
  `sqlite-client.ts` (migration 29), plus `products.stock_counted_at` and the supplier↔category
  join table. The repo's own `sqlite-schema.test.ts` caught the omission before I did — the POS
  never runs `prisma migrate`, so a Prisma-only column is a P2022 on every terminal at once.
- **Analytics** is a port of the server's seven queries to the SQLite dialect, not a reuse of
  `analytics:getData`: that handler omits `productRanking` entirely, sorts `topProducts` by
  quantity instead of revenue, and caps the category breakdowns at ten rows. `rankProducts()` is
  imported from the server module — pure, already tested, too subtle to copy.
- **Goods reconciliation** returns `ledgerEnabled: false` with empty lines. Not laziness: the
  `StockMovement` ledger is off by default on the VPS too, and the server's own empty-ledger path
  reports every counted product as a surplus and every stocked product as drifting. Porting it
  faithfully would ship a screen of false shortages.
- **Money reconciliation** is served from *better* inputs than the server has — cash taken,
  pay-ins, pay-outs and refunds derived from the shift's own rows, where the VPS can only read
  pre-computed totals because it hard-deletes refunded sales.
- **Genuinely impossible offline**, each answering 503 with a reason rather than failing oddly:
  AI invoice scanning (needs the vendor's key), the MXIK catalogue (a Postgres-only reference
  table), banner image upload. Terminal logs and super-admin store management return empty or
  synthesised results — a local login can only be ADMIN or USER anyway.

### Security

Binding to `0.0.0.0` puts the shop's database on the Wi-Fi, so: every route but login is guarded;
tokens carry an audience so a POS session token cannot authenticate a browser and vice versa;
login is throttled per phone (8 tries, 5 min); path traversal is blocked and tested; internal
errors never reach the network. One deliberate divergence — the VPS's `GET /users/:id` returns
the bcrypt hash, and this does not. Behind TLS and a super-admin session that is defensible; over
plain HTTP on a shop LAN it is not.

### Packaging

`dist-web`, not `dist/web`: `dist` is electron-builder's own output directory, which it excludes
from `files`. `npm run build:web` builds the SPA and stages a copy; `build:pos` now runs it first.
`jsonwebtoken` was an undeclared transitive dependency that main already relied on — now explicit.

### Verified

- `tsc --noEmit` 0 errors; `electron-vite build` clean; the generated Prisma client confirmed
  *not* bundled into the main process (it must stay a runtime require).
- 240 jest tests pass, 81 of them new: router matching, stocktake arithmetic, static file serving
  and traversal, and a 43-case integration test that boots the real HTTP server against a real
  SQLite database and exercises login, CRUD, a full stocktake, analytics and reconciliation.
- `electron-builder --dir`: confirmed `dist-web/index.html`, its hashed assets and
  `node_modules/jsonwebtoken` are all inside `resources/app`.

Not verified by me: opening the dashboard from an actual phone on the shop Wi-Fi, and the
dashboard's own screens rendering against these responses end to end.

---

# Per-store super-admin password (manager override)

A super admin sets a password per store in the dashboard; the terminal caches its bcrypt hash and
demands it before a sensitive action. Verified locally, so it works for an OFFLINE_ONLY store.

## Done

- [x] `Store.superAdminPassword` (bcrypt hash) + migration `20260908000001_...`.
- [x] `superAdminPassword` on the create and update DTOs — plaintext in, hashed in the service.
      Three intents: absent = unchanged, `""` = clear, a value = replace.
- [x] **Leak fix.** `findAll()`/`findById()` had no `select` and returned every column, and
      `GET /stores/:id` is reachable by a store's own ADMIN — a hash there would have let them
      crack their own override offline. Both now use an explicit allowlist and expose only
      `hasSuperAdminPassword: boolean`. An allowlist, not a strip, so the *next* sensitive column
      is invisible by default too.
- [x] `GET /store-config` returns the hash. The one endpoint that does, scoped by the caller's
      own JWT.
- [x] `LocalConfig.superAdminPassword` + **migration 30** in `sqlite-client.ts`.
- [x] `setup:complete` fetches it **in the main process**, so the hash never enters the renderer.
      Best-effort: a failure never breaks setup.
- [x] `syncStoreConfig()` refreshes it each cycle. Keyed on the field being *present*, so an
      explicit null (the super admin clearing it) applies while an older server changes nothing.
      The `config:modeChanged` event deliberately does not carry it.
- [x] `auth:hasSuperAdminPassword` / `auth:verifySuperAdminPassword`, side-effect-free like
      `auth:verifyTerminalAccess`. Throttled via `AttemptThrottle` (5 tries / 60s, in memory —
      persisting it would let anyone lock the manager out of their own till).
- [x] `SuperAdminGateProvider` + `useSuperAdminGate().require(action)`. **No password set → the
      action just runs**, which is what keeps every existing terminal behaving as it does today.
- [x] Reference use: deleting a receipt (`SalesHistoryModal`).
- [x] Dashboard field in `StoreFormModal` (serves both create and edit), with an explicit
      "remove the password" checkbox since blank means "leave unchanged".

## Notes

- The gate lives in `components/gate/`, not `context/` — `src/web/tsconfig.json` compiles
  `src/renderer/context/**`, and this file uses `window.electronAPI`, which the web build has no
  type for. Anything POS-only must stay out of the directories that include list names.
- **What this buys:** it deters a cashier at the till. It does not stop someone who owns the
  machine — the hash is in the terminal's SQLite and can be attacked offline. bcrypt cost 10 makes
  that slow, not impossible. Every admin password on the terminal is already stored the same way,
  so this adds no new exposure, but it should not be sold as more than it is.

## Verified

0 type errors on both tsconfigs; `nest build`, `electron-vite build` and the web build all clean;
295/295 jest tests (25 new). The new tests cover the leak (including asserting the serialized JSON
contains no `$2b$`), the throttle's timing on a driven clock, and a real-database check that an
unconfigured terminal stays open while a configured one accepts only the right password.

Not verified by me: the dashboard field and the POS prompt end to end in a running app. The
PostgreSQL migration has not been applied anywhere — per CLAUDE.md it goes to `dev`/staging first.
