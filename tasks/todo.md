# Marking Check page (POS terminal)

Goal: a staff-facing "Проверка маркировки" screen in the Electron POS — scan/paste a DataMatrix,
see what the marking registry says about it, before it blows up at fiscalization.

## Decisions (settled 2026-08-10)

- **Oracle = Asl-Belgisi**, not REGOS. REGOS `Ofd/CheckLabel` was probed and *fails open*: it
  returns `isValid: true` for a tampered serial, `label: "ABCDEF"`, a bogus ICPS and a wrong
  package_code. It only errors on missing `inn`/`icps`/`label`. Unusable as a verdict.
- **Route through the VPS proxy** (`POST /aslbelgisi/verify`), NOT xtrace directly. The POS bundle
  ships with `asar: false`, so an API key baked into the Electron app is readable on every
  terminal. `ASL_BELGISI_INTEGRATION.md` already mandates proxying for exactly this reason.
- **Offline-first**: an unreachable registry must render "не проверено", never a red "invalid".
  REGOS:VCR stays the authoritative gate at fiscalization.

## Blocker (resolved by in-app key rotation, 2026-08-13)

- [x] `ASLBELGISI_API_KEY` was **inactive** — xtrace returned
      `401 {"code":"access-denied","specificError":"Provided token isn't active"}`. Confirmed live
      against staging (`dev.pos.bobur-dev.uz`, which is where this terminal points via
      `local_config.api_url`).
- [x] Keys are issued for 3 months, so a redeploy per rotation is the wrong shape. Admins now paste
      a new key straight into the Marking Check screen; it is stored **per store on the VPS**
      (`system_settings.aslbelgisi_api_key`), never on the terminal. `ASLBELGISI_API_KEY` stays as
      the fallback for stores that never rotated one.
- [ ] User: deploy `dev`, then paste the freshly generated key on the Marking Check page.

## Tasks

- [x] `src/shared/utils/marking.ts` — added `normalizeDataMatrix()`, `stripCryptoTail()`,
      `toSoldCodeKey()`, `extractGtinFromDataMatrix()`
- [x] `src/server/modules/aslbelgisi/aslbelgisi.service.ts` — imports the shared `stripCryptoTail`
      instead of its private copy (identical body; `nest build` clean)
- [x] `src/main/marking/circulation-check.ts` — `verifyMarkingCodeDetails()` returns full
      `MarkingCodeDetails` + `reachable` + diagnosable `error`
- [x] `src/main/ipc/marking-check-handlers.ts` (new) — `markingCheck:verify`
- [x] `src/main/ipc/handlers.ts` — registered
- [x] `src/main/preload.ts` — `markingCheck` namespace + types
- [x] `src/renderer/api/ipc-client.ts` — typed wrapper
- [x] `src/renderer/pages/Marking/MarkingCheckPage.tsx` (new)
- [x] `src/renderer/App.tsx` — route `marking-check`
- [x] `src/renderer/components/layout/Sidebar.tsx` — nav item in **Main**, after Товары
- [x] `src/renderer/i18n/locales/{ru,uz}.json` — 27 keys each
- [x] `npx tsc --noEmit` exit 0; `npx electron-vite build` exit 0; 16/16 marking tests pass

## Follow-up: friendly errors + in-app key rotation (2026-08-13)

- [x] `Product.name` doesn't exist (bilingual `nameUz`/`nameRu`) — the enrichment `findFirst` threw
      on every check and the `catch {}` hid it. Fixed in handler, preload type and page.
- [x] Server: per-store key resolution (`system_settings.aslbelgisi_api_key` → env fallback),
      `GET /aslbelgisi/api-key` (status + expiry), `PUT /aslbelgisi/api-key` (ADMIN, probes xtrace
      before saving). Upstream 401/403 is translated to `REGISTRY_KEY_REJECTED` **502** so the POS
      can't confuse a dead registry key with its own expired JWT.
- [x] POS: `circulation-check.ts` normalizes every failure into one code vocabulary
      (`NO_TOKEN`/`OFFLINE`/`TIMEOUT`/`SESSION_EXPIRED`/`FORBIDDEN`/`REGISTRY_*`/`HTTP_n`);
      IPC `markingCheck:apiKeyStatus` + `markingCheck:setApiKey`.
- [x] Page: sentence-level error + a "what to do" hint (admin vs cashier), admin-only key card with
      masked current key, source, expiry date and a 14-day warning; re-runs the check after a save.
- [x] i18n: 24 new keys × ru/uz. `npx tsc --noEmit`, `nest build`, `electron-vite build` all clean.

## Review

**Bug caught during implementation.** The first cut looked up `sold_marking_codes` by the
asl-belgisi lookup key (crypto tail stripped). The sale path actually stores `normalizedNoGS` —
GS bytes removed, **crypto tail kept** (`POSScreen.tsx:592`) — so the "already sold" warning would
have silently never fired. Hence two explicitly-named helpers, `stripCryptoTail()` (registry lookup
key) vs `toSoldCodeKey()` (sale-path storage key), with a test asserting they differ.

**What the page shows:** verdict badge (in circulation / out of circulation / not found / unknown /
unreachable), an "already sold on terminal X" warning, the matching local product when the GTIN is
one we stock, and the registry detail grid (status, extended status, GTIN, package type, production
and expiry dates, series, issuer). Enter submits (scanners send a trailing Enter); Shift+Enter is
kept for multi-line paste.

**Offline behaviour:** an unreachable registry renders a neutral "не проверено" with the raw error
code, never a red verdict — a dead network must not look like a bad code.

**NOT verified end-to-end:** the live registry round-trip. `ASLBELGISI_API_KEY` is inactive, so
every real call currently returns the `reachable: false` branch. Once the key is refreshed, check a
known-good code (expect IN) and a made-up serial (expect NOT_FOUND).

**Pre-existing, untouched:** `npm run lint` is broken repo-wide — ESLint 9 requires
`eslint.config.js` and the repo only has the legacy config. Unrelated to this change.

**Not bumped:** `package.json` version, per the bump-at-deploy convention.
