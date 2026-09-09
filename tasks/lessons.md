# Lessons

Patterns worth not repeating, recorded as they come up.

## An "already exists" guard around schema creation hides every table added later

`createSchemaIfNeeded` in `src/main/database/sqlite-client.ts` returned early when `local_config`
was present. That made sense once — the tables did exist. But it meant a table added to that
function *afterwards* never reached a terminal whose database predated it. `audit_logs` shipped
exactly that way: present on databases created after it was added, missing forever on older ones,
and `smena:getCurrent` died with `no such table: audit_logs` on one store's terminal only.

`sqlite-schema.test.ts` could not catch it. That test walks the Prisma models, and `audit_logs` is
raw SQL — invisible to the very guard that exists for this class of failure.

**Rule:** schema setup must be idempotent and unconditional, not guarded on "does the first table
exist". Every statement there was already `IF NOT EXISTS`; running them all on every boot costs a
few no-op DDL parses and keeps a fresh database and an upgraded one identical. Where a check can
only see Prisma models, add one that starts from a *legacy* database and asserts the real outcome
— `legacy-upgrade.test.ts` does that, and fails on all five cases if the guard returns.

**Also: prove a regression test fails before trusting it.** The first run of that test passed with
the bug supposedly restored — the `sed` meant to re-introduce the guard had silently not matched,
so the test ran against the fixed code and proved nothing. Re-introducing the guard with a real
edit turned all five cases red, which is the only evidence that counts.

## `loadEnv(mode || 'pos', …)` never loaded `.env.pos` — and baked a DB password into the installer

`electron.vite.config.ts` did `loadEnv(mode || 'pos', process.cwd(), '')`. electron-vite always
supplies a mode (`development`/`production`), so the `|| 'pos'` fallback never fired and `.env.pos`
was never read. Vite's `loadEnv` still loads the root `.env` — the *server's* config — so every
`APP_ENV_KEYS` value came from there.

Two consequences, one cosmetic and one not:

- Editing `.env.pos` appeared to do nothing, because none of it was ever baked. `VPS_API_URL` and
  `STORE_ID` fell through to the hardcoded defaults in `app-config.ts`.
- `DATABASE_URL` *was* in the root `.env`, so `define` replaced `process.env.DATABASE_URL` at the
  one site that reads it — a startup diagnostic — with the literal
  `postgresql://postgres:<password>@localhost:5432/grocery_pos`. That string was compiled into
  `dist-electron/main/index.js`, shipped inside the installer, logged on every terminal boot, and
  uploaded by `flushLogs()` → `POST /logs/upload` into the VPS `terminal_logs` table.

**Rules:**
- Never pass a mode through `||` into `loadEnv`. Name the env file you mean: `loadEnv('pos', …)`.
- Only bake what the bundle actually needs. `DATABASE_URL` was never read at runtime — the
  terminal derives its own SQLite path and passes it to Prisma explicitly — so baking it bought
  nothing and cost a credential. It is now out of `APP_ENV_KEYS`.
- Redact connection strings before logging, fail-closed. These logs leave the machine. The first
  redactor tried to keep the username (`//user:***@`) and leaked half of a password containing an
  unescaped `@`; the greedy form that drops the whole authority is the right trade — over-redacting
  a diagnostic costs nothing.

## The web dashboard has two output directories, and the terminal serves the second one

`cd src/web && npm run build` writes to `dist/web` — which is what the **NestJS server** serves.
The **terminal's LAN dashboard** serves `dist-web`, a staged copy, because electron-builder
excludes its own output directory (`dist`) from the package. `scripts/stage-web-for-pos.mjs` makes
that copy, and `npm run build:web` is the script that runs both steps.

Running only the inner build looks like a complete success — Vite prints its asset table and exits
0 — while the running terminal keeps serving a build from the previous day. The report of "changes
not applied" was correct, and the source was fine the whole time: `dist-web/` was stamped a day
older than `dist/web/`, which is the check that would have caught it in seconds.

**Rules:**
- Build the web dashboard with `npm run build:web` from the repo root, never `npm run build` inside
  `src/web`. CLAUDE.md documents this; I used the inner one because I was already `cd`-ed there.
- A build is not evidence that the thing under test changed. When a change is verified by someone
  looking at a running app, check the artifact that app actually loads — compare timestamps, or
  grep the shipped bundle for a fingerprint of the new code. "It compiled" and "it is deployed" are
  different claims, and only the second one answers "is it live".
- The same split exists for the POS itself: `dist-renderer`/`dist-electron` are built, but a
  *packaged* terminal reads them from inside its installer, so an unpacked dev run and an installed
  one need different steps to pick a change up.

## The dashboard has two backends, and an OFFLINE_ONLY store never talks to the VPS one

`/analytics/data` exists twice: `src/server/modules/analytics/analytics.service.ts` (NestJS,
PostgreSQL) and `src/main/local-server/routes/analytics.ts` (the terminal's own HTTP server,
SQLite). The file itself says it is "a direct port… the same seven queries, translated". An
ONLINE store's dashboard hits the first; an OFFLINE_ONLY store's LAN dashboard hits the second and
never reaches the VPS at all.

A field added to the Nest service therefore reaches an OFFLINE_ONLY shop only if it is added to
the local route too. `rankingCategories` was added to one and not the other, and the dashboard
rendered an empty filter with `undefined` in the console — for the store that is precisely the one
running offline.

**Rules:**
- Changing an analytics/report endpoint means changing BOTH implementations. Grep
  `src/main/local-server/routes/` for the path before assuming a server change is complete.
- The same split exists for auth, products, suppliers, sales and inventory — the whole
  `local-server/routes/` directory mirrors Nest controllers.
- The shape assertion in `local-server.integration.test.ts` ("every section the dashboard reads")
  is the guard that catches this, and it did — it failed the moment the key list diverged. Keep
  that test exhaustive rather than loosening it to `toMatchObject`.
- When a symptom is "the API did not return X", identify WHICH server answered before concluding
  anything about deployment. Here the natural guess — "staging is not deployed to the VPS" — was
  reasonable and still wrong, because the VPS was not in the request path.
