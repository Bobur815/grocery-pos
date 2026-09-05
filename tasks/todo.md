# Task: per-user PIN (move `storePin` from LocalConfig → User)

## Decisions (confirmed with user)
- PIN is **local to the terminal** — SQLite `User.pin` only. No PostgreSQL/server/sync changes.
- PIN is editable **in the Electron app only**: own PIN in Settings → User settings, and an ADMIN
  may set/clear a PIN for any user in Users → user form.
- PIN is **1–4 digits** ("up to 4"), stored bcrypt-hashed, unique among active users of the store.

## Steps
- [x] `prisma/schema.sqlite.prisma`: drop `LocalConfig.storePin`, add `User.pin`
- [x] `npm run prisma:generate:sqlite` (no `db push` — runtime migration owns the column)
- [x] `sqlite-client.ts`: drop `store_pin` from CREATE TABLE + delete "Migration 1";
      migration 27 adds `users.pin` and carries the old store PIN over to the first active cashier
      (exactly who the old `loginWithPin` logged in as)
- [x] `seed.ts`: drop `storePin: null`
- [x] `auth-handlers.ts`:
      - `auth:loginWithPin` → match the PIN against active users of this store, log in as that user
      - `auth:isPinConfigured` → any active user of this store has a PIN
      - `auth:verifyTerminalAccess` → any active user's PIN, else an active admin's password
      - `auth:setupPin` → current user, 1–4 digits, reject a PIN already taken in the store
      - new `auth:hasPin`, `auth:removePin`
      - `users:getAll` returns `hasPin` (never the hash); `users:create`/`users:update` accept `pin`
- [x] `preload.ts` + renderer `ipc-client.ts`: expose `hasPin` / `removePin`
- [x] `PinLoginPage`: submit button + Enter for PINs shorter than 4; post-login redirect keys off
      *this user's* PIN (`auth.hasPin()`), not the store's
- [x] `SetupPinPage`: 1–4 digits, surfaces `pin_taken`, skip link (a PIN stays optional)
- [x] `SetupWizard` + `setup:complete`: dropped the store-PIN step — there is no user row to attach
      a PIN to at setup time; the admin now sets a personal PIN right after first login
- [x] `AppBar`: a PIN session shows the user chip + logout like any other login
- [x] `UserSettings`: PIN section (set / change / remove own PIN)
- [x] `UserForm`: optional PIN field for admins + "remove PIN"
- [x] i18n `ru.json` / `uz.json`
- [x] `tsc --noEmit` clean, `npm test` 132/132, migration verified against a real SQLite DB

## Review

**Model.** `LocalConfig.storePin` (one shared PIN per terminal) is gone; `User.pin` (bcrypt, 1–4
digits, nullable) replaces it. A PIN now identifies a person, so `loginWithPin` signs in the user
who owns it — cashier or admin — instead of always signing in "the first active cashier".

**Uniqueness.** `hashNewPin()` refuses a PIN another active user of the store already has
(`auth.errors.pin_taken`). Without it, PIN login would be ambiguous and the earlier-created user
would silently take over the other's session, shift and receipt name.

**Store scoping.** Candidate lookup filters on `LocalConfig.storeId`, so a user row cached from
another store can never unlock this terminal — matching what `auth:login` already enforced.

**Upgrade path.** Migration 27 hands the existing store PIN to the first active cashier, i.e. the
account the old flow logged in as, so the same digits open the same session after the update.
`local_config.store_pin` is left on disk (SQLite cannot drop a column) but is never read again.

**Setup wizard.** Its PIN step had nowhere to attach a PIN — no local user row exists at
`setup:complete` — so it was removed. The admin now sets a personal PIN immediately after the
first password login, via the existing `/setup-pin` redirect, which every new cashier also gets.

**Not changed:** the PostgreSQL schema, the server, and both directions of user sync. `syncUsers`
does not write `pin`, so a synced-down user keeps whatever PIN they set on this terminal.

**Known limits (by the local-only decision):** a PIN must be set per terminal and is lost on
reinstall.

**Left broken as found:** `npm run lint` fails repo-wide — ESLint 9 needs `eslint.config.js` and
the repo only has the old `.eslintrc.*`. Unrelated to this change.

---

# Follow-up: QuickPayRow did not fit a narrow POS column

`InputColumn` is a quarter of the window, so on a small monoblock it lands around 230–300px —
where cash + card + UzQR (icon, label and shortcut hint each) needed ~380px. The row spilled out
of the column, UzQR worst of all. Two causes: `grid-template-columns: 1fr 1fr 1fr` floors each
track at its content width, and the buttons had nothing that could give.

**Fix.** `InputColumn` became a size container (`container-type: inline-size`), and the row's
tracks became `minmax(0, 1fr)`. The buttons then shed detail as the column narrows — hint shrinks,
hint goes, icon goes, label goes — so they adapt to the column rather than to the viewport. No
mobile layout and no viewport breakpoints: the screen never restacks, it only trims.

Measured in Electron's own Chromium (`scratchpad/quickpay-fit.html` + `measure.js`), old vs new,
column 170px → 640px. Old: spilled up to 193px at every width under ~365px. New: no spill and no
ellipsised label anywhere in that range. The ladder:

| column | shown |
|---|---|
| ≥ 441px | icon + label + 14px hint (unchanged from before) |
| 376–440px | icon + label + 11px hint, tighter padding |
| 316–375px | icon + label |
| 216–315px | 12px label only (UzQR keeps its wordmark) |
| ≤ 215px | icon / wordmark only |

Every button now carries `title` + `aria-label`, since the narrow steps drop its visible text.
