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
