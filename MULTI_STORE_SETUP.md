# POSGRO — Multi-Store (Branches) + Offline/Online Mode Setup

> **This is a PLANNING brief for Claude Code, not an implementation spec.**
> Claude Code must enter `/plan` mode, **analyze the actual codebase first**, ask the open
> questions below, and produce a written plan **before writing any code**. Do not guess.
> Do not assume the documentation matches the current code — inspect the real files.

---

## 0. Prime directive (read first, non-negotiable)

There is **one real, live store currently running in ONLINE mode.** Nothing in this task
may break it.

- **Do not** delete, rename, or drop any Prisma model, column, or Postgres volume
  (`posgro_postgres_data`) without a verified backup and an explicit go-ahead.
- Every schema change must be **additive and reversible** (nullable columns first,
  backfill, then tighten). No destructive migrations.
- The live store **will** be affected by two of these changes on purpose:
  1. disabling local admin CRUD in the Electron app (online mode), and
  2. narrowing the sync service scope.
  Both must be behind a flag/mode check so they can be rolled out and rolled back
  without a rebuild-and-redeploy panic.
- Before touching anything, Claude Code must state **exactly which files it will change**
  and **how the live store is protected at each step**.

---

## 1. Objective

Add two capabilities to POSGRO without a rewrite:

1. **Multi-store / branches** — multiple stores under one system, provisioned by a
   **super admin** only.
2. **Per-store database mode** — each store is either:
   - **OFFLINE_ONLY** — local SQLite is the source of truth, **no sync**, full admin
     features stay local; or
   - **ONLINE (hybrid)** — server (VPS) is the source of truth, Electron becomes
     cashier-focused, admin management moves to the web dashboard, and a **reduced**
     sync service runs.

Plus login-screen setup controls (server URL + phone/QR web access) described in §5.

---

## 2. What Claude Code must analyze before planning

Enter `/plan`. Read the real code and report findings — **do not rely on the docs.**
Produce a short inventory of:

1. **Prisma schema** — actual models, which entities already carry a store/branch/terminal
   field, ID types (the docs show inconsistent `String` vs `Int` IDs — verify the truth),
   and every relation that would need a `storeId`.
2. **Role system** — the real `UserRole` enum and every place `RolesGuard` / `@Roles()` is
   applied. Confirm whether a `SUPER_ADMIN` concept already exists.
3. **Sync service** — the actual sync entrypoints (upload + download), what entities each
   direction touches today, and where the sync interval/loop is started.
4. **Electron vs Web split** — confirm whether a separate web admin frontend already exists,
   how it's built and served (Vite dev server? static build behind NestJS/Nginx?), and what
   route the "web" version lives on.
5. **`StockManagement.tsx`** and the create/edit surfaces for products, users, suppliers,
   inventory, and arrivals — list the exact components/pages and how they're routed and
   guarded today.
6. **Login page** — where server URL / API base URL is currently configured (env? hardcoded?
   localStorage? a config file?), and how the Electron renderer discovers the backend.
7. **Config/settings storage** on the terminal — is there a local settings table, an
   `electron-store`, a JSON config, or only env vars?

Output this as a findings section at the top of the plan. Flag every place where the code
contradicts this brief or the docs.

---

## 3. Target architecture (conceptual — confirm before building)

| Concern | OFFLINE_ONLY store | ONLINE (hybrid) store |
|---|---|---|
| Source of truth | Local SQLite on the main terminal | VPS PostgreSQL |
| Sync service | **Off** | **On, reduced scope** (see §7) |
| Product / user / supplier CRUD | Local, in Electron | **Web admin only** (disabled in Electron) |
| Inventory / arrivals / `StockManagement` | Local, in Electron | **Web admin only** |
| Cashier POS (sales, cart, receipt, shift) | Local | Local (then synced up) |
| Backend location | One designated LAN terminal runs NestJS + local DB | VPS |
| Web admin access from phone | Auto-served on LAN, QR on login | Points to VPS admin URL |

**Branch model:** introduce a `Store` (branch) entity. The current live store becomes
**branch #1** via backfill. Attach `storeId` to the entities that are branch-scoped
(products, users, sales, inventory, suppliers, shifts, etc. — Claude Code must produce the
exact list from §2 and get it confirmed).

**Roles:** add `SUPER_ADMIN` above `ADMIN`. Only super admin can create branches and set a
branch's mode. Regular `ADMIN` manages within their own branch.

---

## 4. Super admin dashboard (branch + mode control)

Requirements:
- Only `SUPER_ADMIN` can: create a new branch, edit a branch, and set a branch's mode
  (OFFLINE_ONLY vs ONLINE).
- Mode and branch identity must reach the terminal. **This is the central open question**
  (see §8, Q1): an OFFLINE_ONLY store by definition does not sync, so it cannot be reached
  over the internet after activation. The plan must state exactly how an offline terminal
  learns its mode and store identity.

---

## 5. Login page controls

At the **bottom of the login page**, add:

1. **Settings button (⚙)** — opens a dialog to set the **server URL**:
   - Offline mode: `http://localhost:<port>` (single terminal) **or** the LAN IP of the
     designated main terminal (e.g. `http://192.168.1.7:3000/api`) when terminals share Wi-Fi.
   - Online mode: the VPS URL, e.g. `https://dev.pos.bobur-dev.uz/api`.
   - The chosen URL must persist locally (decide storage in §2.7) and be used as the API base.

2. **Phone icon (📱)** — shows how to open the **web admin dashboard from a phone** on the
   same Wi-Fi, e.g. `http://192.168.1.7:5173/web/` (LAN IP + port + `/web/` route), rendered
   as a **scannable QR code**.
   - In **OFFLINE_ONLY** mode this web endpoint must be **served automatically** by the main
     terminal (bound to `0.0.0.0`, not `127.0.0.1`), and the current LAN IP must be detected
     and shown as the QR.
   - In **ONLINE** mode the QR/link points to the VPS admin URL instead.

The plan must specify how the LAN IP is detected reliably (multiple NICs / VPN adapters are a
known trap) and how the web admin is actually served in a production offline install
(a `vite dev` server on a shop terminal is not acceptable for production — see §8, Q4).

---

## 6. Offline-only mode behavior

- Local SQLite is the primary DB. **Sync service does not start.**
- All admin features (products, users, suppliers, inventory, arrivals, `StockManagement`)
  remain fully usable locally in Electron.
- The web admin is auto-served on the LAN for phone access (§5.2).
- No dependency on internet for any core flow.

---

## 7. Online mode changes (this affects the live store — handle with care)

For stores in **ONLINE** mode, in the **Electron app only**:
- **Disable** create/edit for: products, users, suppliers.
- **Disable** inventory management and arrivals.
- **Remove `StockManagement.tsx` from the Electron navigation entirely** — it becomes
  web-admin-only.
- These management functions live on the **web admin dashboard** (served by the VPS).

**Sync service scope (online mode) — reduce to an explicit allowlist:**
- Sales / sale items (upload)
- Product stock **increment/decrement** deltas (not full product master edits)
- Checks / receipts
- Smena (cashier shift) open/close + cashier sessions
- Anything else genuinely tied to cashier operation — Claude Code proposes the final list

Everything else (product master data, users, suppliers, categories, inventory arrivals)
becomes **server-authoritative**: pulled down to the terminal, never pushed up from it.

**Gating rule:** all of the above must be conditional on `store.mode === ONLINE`. Offline
stores keep full local CRUD. Implement as a mode check / feature flag, not a hard deletion,
so the live store can be toggled and, if needed, reverted.

---

## 8. Questions Claude Code MUST ask before coding (do not guess)

Present these in the plan with a recommended default for each, then wait for answers.

**Q1 — Offline provisioning.** How does an OFFLINE_ONLY terminal learn its store identity and
mode if it never syncs?
- *Recommended:* one-time online **activation** — terminal contacts the VPS once, pulls its
  branch config (mode, storeId, name), stores it locally, then runs fully offline. Fallback:
  a signed activation code/config file the super admin generates and the operator enters at
  setup. Reject any design that requires the offline store to be permanently reachable.

**Q2 — Offline topology.** Is offline mode **single-terminal** (one machine, its own SQLite)
or **multi-terminal on LAN** (one "main" terminal runs the backend + DB, others connect by IP)?
- *Recommended:* support both — treat single-terminal as the special case of "main terminal =
  this machine." The server-URL setting in §5.1 already covers pointing satellites at the main IP.

**Q3 — ID strategy for branch scoping.** The docs mix `String @id @default(cuid())` and
`Int @id @default(autoincrement())` across models. What are the real ID types, and how should
`storeId` be typed and backfilled so the **live store becomes branch #1** without breaking FKs?
- *Recommended:* additive nullable `storeId` → backfill all existing rows to branch #1 →
  make non-null in a later migration once verified.

**Q4 — Web admin serving in offline installs.** How is the web admin currently built/served,
and how should it be served on an offline shop terminal (a built static bundle served by the
local NestJS/embedded server bound to `0.0.0.0`, **not** `vite dev`)?
- *Recommended:* production static build served by the local backend on a fixed port, with
  LAN-IP autodetection for the QR.

**Q5 — Super admin bootstrap.** Does `SUPER_ADMIN` exist yet? If not, how is the first super
admin created (seed script? promote the existing admin?), and does the live store's current
admin stay a plain `ADMIN` scoped to branch #1?

**Q6 — Live-store rollout.** For the online-mode restrictions and sync narrowing on the live
store: flip immediately after test, or ship behind a runtime flag defaulting to "current
behavior" and enable per-branch from the super admin dashboard?
- *Recommended:* runtime flag, default = current behavior, enable per-branch. Safest for the
  one live store.

**Q7 — Sync allowlist confirmation.** Confirm the exact entities that stay in the online sync
(§7) — especially whether stock deltas, shift data, and any loyalty/discount data are in scope.

**Q8 — Conflict & authority rules.** In online mode, if a terminal has a locally cached
product that the server later changes, confirm server-wins for master data and terminal-wins
only for its own sales/deltas.

---

## 9. Deliverables from `/plan` mode (before any code)

Claude Code must output, and get approval on, all of the following before implementation:

1. **Codebase findings** (§2) with contradictions flagged.
2. **Confirmed schema change list** — new `Store` model, `SUPER_ADMIN` role, exact
   `storeId` additions, and the **multi-step, additive, reversible** migration plan that
   backfills the live store as branch #1.
3. **Mode-gating map** — every Electron surface that changes by mode, and how each is gated.
4. **Reduced sync-service design** — the final entity allowlist and direction (up/down) per entity.
5. **Login-page changes** — settings dialog, server-URL persistence, phone/QR web access,
   LAN-IP detection approach, and offline auto-serve behavior.
6. **Super admin dashboard scope** — branch create/edit + mode toggle, and the offline
   provisioning answer from Q1.
7. **Live-store protection & rollback plan** — backup step, feature-flag default, and the
   exact sequence to enable the new behavior on the one real store without downtime.
8. **Open questions answered** — Q1–Q8 resolved with the user before writing code.

Only after this plan is approved should Claude Code leave `/plan` mode and implement,
following the existing codebase patterns (NestJS `RolesGuard`/`@Roles()`, styled-components,
RU/UZ i18n keys for every new UI string, and the existing Prisma conventions).
