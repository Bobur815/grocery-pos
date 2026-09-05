# Spec: terminal credentials, so a POS never needs a password again

Status: **proposed** — not implemented. Written 2026-09-05.

## Why

A PIN login never reaches the VPS: it has no password to send. Today the only thing that mints a
server token is a phone+password login, so a terminal driven entirely by PIN loses its credential
when the JWT expires (`JWT_EXPIRES_IN=14h`) and stops uploading sales and closed shifts. The
sync loop now says so out loud instead of going quiet (`sync.errors.serverLoginRequired`), but
saying it is not fixing it.

The goal is the opposite of a longer-lived user token:

- **The terminal, not the person, holds the server credential.** A cashier's PIN is a local
  session — identity for the receipt, the shift and the audit log — and never a server login.
- **Password authentication happens once, at setup**, by the store admin or by the super admin
  installing the machine. After that the terminal keeps itself authenticated forever, unless a
  human revokes it.
- Sales and shifts already carry `cashierId`, `cashierName` and `cashierPhone` in their payloads,
  so attribution does not depend on who the authenticated principal is. This is what makes the
  split possible without touching reporting.

## Shape

Two credentials, which is the whole trick:

| | Terminal token | Access token |
|---|---|---|
| Form | Opaque `<uuid>.<secret>` | JWT |
| Lifetime | 180 days, sliding | 1 hour |
| Issued by | `POST /terminals/register` (admin password login, once) | `POST /auth/terminal/token` |
| Stored | On the terminal, encrypted at rest; **hashed** on the server | Memory only, as today |
| Sent | Only to the refresh endpoint | `Authorization: Bearer` on every sync call |

The long-lived credential never travels except to mint a short one, and the short one is the only
thing that touches the sync surface. A leaked access token dies in an hour; a leaked terminal
token is revocable from the dashboard.

---

## 1. Data model

New model in `prisma/schema.prisma` (PostgreSQL only — the terminal stores its copy in SQLite):

```prisma
model Terminal {
  id         String  @id @default(cuid())   // the <uuid> half of the terminal token
  storeId    String  @map("store_id")
  store      Store   @relation(fields: [storeId], references: [id])
  terminalId String  @map("terminal_id")    // "T1" — the human-facing id already used everywhere

  /// SHA-256 of the secret half. High-entropy secret, so a fast hash is correct here; bcrypt
  /// would only slow down the refresh path without adding anything.
  tokenHash  String  @map("token_hash")

  /// Who authorised this machine, kept for the audit trail rather than for any check.
  createdById String?  @map("created_by_id")
  deviceName  String?  @map("device_name")

  lastSeenAt DateTime? @map("last_seen_at")
  lastSeenIp String?   @map("last_seen_ip")
  expiresAt  DateTime  @map("expires_at")
  revokedAt  DateTime? @map("revoked_at")

  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  @@unique([storeId, terminalId])  // re-registering the same terminal supersedes its credential
  @@index([storeId])
  @@map("terminals")
}
```

`@@unique([storeId, terminalId])` is the anti-theft property: reinstalling on the same machine, or
re-running setup after a disk swap, replaces the old row's hash, so the credential on a
decommissioned PC stops working the moment the replacement registers.

Note this is a *new* table — `TerminalHeartbeat` and `TerminalLog` stay as they are and keep
keying on the `(storeId, terminalId)` string pair. No migration of existing data is needed.

---

## 2. Endpoints

### 2.1 `POST /terminals/register` — once, at setup

Auth: an ordinary **user** JWT belonging to an ADMIN of the store, or a SUPER_ADMIN.
Guards: `JwtAuthGuard, StoreGuard, RolesGuard` + `@Roles(ADMIN)`.

```jsonc
// request
{ "storeId": "store_abc", "terminalId": "T1", "deviceName": "Kassa 1 (Windows 10)" }

// 201
{
  "terminalToken": "clx9f2.9c1f…64 url-safe chars",   // shown once, never retrievable again
  "terminalUuid": "clx9f2",
  "expiresAt": "2027-03-04T09:12:00.000Z"
}
```

`storeId` goes in the **body on purpose**: `StoreGuard` reads `request.body.storeId`, which is the
one path that lets a SUPER_ADMIN (who has no `storeId` of their own) register a terminal for a
specific store. That is exactly the "I set the machine up myself" case.

Behaviour: upsert on `(storeId, terminalId)`. Always mint a fresh secret and overwrite
`tokenHash`; clear `revokedAt`. Return the token in the response body and **never log it**.

### 2.2 `POST /auth/terminal/token` — every hour, unattended

Auth: none (the terminal token in the body *is* the credential). Must be exempt from
`JwtAuthGuard` and rate-limited.

```jsonc
// request
{ "terminalToken": "clx9f2.9c1f…" }

// 200
{
  "accessToken": "eyJ…",
  "expiresIn": 3600,
  "terminalToken": "clx9f2.7b3e…"   // present ONLY when rotated; client must persist it
}
```

Server steps:

1. Split on the first `.`; look the row up by `id`. Unknown id → `401`.
2. Compare `sha256(secret)` to `tokenHash` in constant time (`crypto.timingSafeEqual`). → `401`.
3. `revokedAt != null` → **`403` with `{ code: "terminal_revoked" }`** — deliberately distinct
   from 401 so the terminal can stop retrying and say so on screen instead of hammering.
4. `expiresAt < now` → `401 { code: "terminal_expired" }`; needs a new setup registration.
5. Update `lastSeenAt`/`lastSeenIp`.
6. If `expiresAt` is less than 30 days out, mint a new secret, store its hash, extend `expiresAt`
   by 180 days and return it as `terminalToken`. Sliding renewal means a terminal that talks to
   the server at least once a month never needs a human again.
7. Sign and return the access token.

**No rotation on every refresh.** Per-use rotation loses the credential whenever a response is
dropped after the write commits — a shop PC on a flaky connection would deauthorise itself. The
30-day window gives ~700 chances to land one successful rotation.

### 2.3 `POST /terminals/:id/revoke` and `GET /terminals` — dashboard

`@Roles(ADMIN)` (SUPER_ADMIN passes everything already). Revoke sets `revokedAt`; the list shows
`terminalId`, `deviceName`, `lastSeenAt`, `lastSeenIp`, `revokedAt`, so a lost machine can be cut
off from the web dashboard. `GET /terminals/status` (heartbeats) stays as it is.

---

## 3. The access token, and the four places the server must learn about it

Claims:

```jsonc
{ "sub": "clx9f2", "typ": "terminal", "role": "TERMINAL",
  "storeId": "store_abc", "terminalId": "T1", "iat": …, "exp": … }
```

Signed with the same `JWT_SECRET` — no second key to manage, and `typ` keeps the two kinds of
token from ever being mistaken for each other.

1. **`src/server/modules/auth/types/auth.types.ts`** — add `typ?: 'terminal'` and
   `terminalId?: string` to `JwtPayload`.

2. **`src/server/modules/auth/auth.service.ts` → `validateUser()`** — this is the load-bearing
   change. Today it calls `usersService.findById(payload.sub)`, so *every* token must resolve to a
   real User row; a terminal token would 401 on arrival. Branch first:

   ```ts
   if (payload.typ === 'terminal') {
     const terminal = await this.prisma.terminal.findUnique({ where: { id: payload.sub } });
     if (!terminal || terminal.revokedAt) return null;   // revoking kills live access tokens too
     return {
       id: terminal.id, storeId: terminal.storeId, terminalId: terminal.terminalId,
       role: 'TERMINAL', active: true,
     };
   }
   ```

   Checking `revokedAt` here is what makes revocation take effect within the hour rather than at
   the next refresh.

3. **`UserRole` stays a three-value Prisma enum.** `TERMINAL` is a principal *kind*, not a user
   role: adding it to the enum would need a migration and would make "a user whose role is
   TERMINAL" representable, which must never exist. `RolesGuard` compares
   `requiredRoles.includes(user.role)` on plain strings and `Roles` is `(...roles: string[])`, so
   a string works with no guard changes. Add the constant next to `USER_ROLES` in
   `src/shared/constants` as a separate `PRINCIPAL_KINDS.TERMINAL`.

4. **`StoreGuard` needs no change** — it only requires a non-SUPER_ADMIN principal carrying
   `storeId`, which the terminal principal does. Worth an added comment saying so, because it is
   not obvious that it already covers a non-user principal.

### Endpoints that must accept `TERMINAL`

Audited against what the sync loop actually calls. Most need nothing, because they never
enumerated roles in the first place:

| Endpoint | Guard today | Change |
|---|---|---|
| `POST /sales/sync` | Jwt + Store | none |
| `POST /smena/sync-bulk` | Jwt + Store | none |
| `GET /products`, `GET /categories`, `GET /settings` | Jwt + Store, no `@Roles` | none |
| `GET /store-config` | Jwt only | none |
| `POST /terminals/heartbeat`, `POST /logs/upload` | Jwt + Store | none |
| `GET /suppliers` | `@Roles(ADMIN, USER)` | **add TERMINAL** |
| `GET /users/sync` | `@Roles(ADMIN, USER)` | **add TERMINAL** |

Everything ADMIN-only stays ADMIN-only. A terminal credential must never be able to push master
data — that is the point of `posAdminLocked`, and master-data upload already runs only while an
admin is signed in on the terminal with their own user token.

---

## 4. Terminal side (Electron)

### Storage

The terminal token goes in `local_config` as a new nullable column `terminal_token`, encrypted
with `safeStorage` (DPAPI on Windows) exactly as `queue-manager` already does for the auth token,
with a plaintext fallback when encryption is unavailable. It must never reach the log file or the
renderer — no IPC handler returns it, and `config:getLocalConfig` must strip it, since that is
already sent to the renderer wholesale.

### Registration

`setup-handlers.ts` → `setup:complete` calls `POST /terminals/register` with the admin token the
wizard already holds, and stores the returned credential. If registration fails the setup does
**not** fail: the terminal falls back to today's behaviour and registers on the next admin
password login, which keeps a bad network from bricking an install.

For terminals already in the field, the same call runs after any successful ADMIN
`auth:login` when `terminal_token` is null. That is the migration path — no re-install.

### Getting an access token

`queue-manager.ts` grows `ensureServerToken(): Promise<string | null>`, and the sync loop calls it
where it calls `getServerToken()` today:

- Return the in-memory access token when it has more than 60s left.
- Otherwise refresh from `terminal_token`, cache in memory, persist the rotated terminal token if
  one came back.
- **Single-flight**: concurrent callers await one in-flight refresh; the sync loop, the heartbeat
  and the log upload all fire in the same cycle.
- On `403 terminal_revoked`: clear both tokens and surface it — a distinct
  `sync.errors.terminalRevoked` so the screen says "this terminal was deauthorised", not
  "sign in with a password".
- On network failure: return the cached token if any, else null. Offline is normal; sales queue
  locally exactly as they do now.

**Treat a 401 from any sync call as the authority on expiry, not the local clock.** Terminal
clocks drift — that already caused the product-sync cursor bug — so on a 401 the loop refreshes
once and retries the call, and only then gives up for the cycle.

The existing user-token path stays as a fallback until every terminal is registered, then the
persisted `server_token` handling can go.

### What this makes possible afterwards

Once terminals hold their own credential, `auth:login`'s VPS round-trip becomes optional and the
login screen can drop the phone+password mode entirely — a cashier PIN unlocks a local session,
and the terminal's own credential carries the sync. That is a follow-up, not part of this spec:
keep password login until registration is proven in the field, because it is also the only way to
recover a terminal whose credential was revoked or expired.

---

## 5. Security

- **TLS is a precondition, not a nice-to-have.** The terminal token is a bearer credential with a
  180-day life. `posgro-api` currently listens on `0.0.0.0:3001` in plain HTTP, bypassing nginx —
  anyone on the path can lift the credential off the wire. Bind it to `127.0.0.1:3001` and let
  nginx terminate TLS *before* this ships.
- Rate-limit `POST /auth/terminal/token` by IP and by terminal uuid. Do **not** auto-revoke after
  N failures: that hands anyone a way to knock a shop's till offline.
- Never log either token. The register response and the refresh request body must be excluded
  from the logging interceptor.
- The credential authorises a fixed, store-scoped surface: upload this store's sales, shifts,
  heartbeats and logs; download its master data. It cannot create users, change prices, or read
  another store.
- Revocation is immediate for refresh and within one access-token lifetime (≤1h) for live calls,
  because `validateUser` re-reads the row.

## 6. Failure modes

| Situation | Behaviour |
|---|---|
| Offline for days | Access token expires, refresh fails, sales queue locally. Recovers on its own when the link returns. |
| Terminal revoked | `403 terminal_revoked` → tokens cleared, on-screen message, no retry storm. Re-register at setup. |
| Terminal token expired (>180d offline) | `401 terminal_expired` → same, needs an admin login to re-register. |
| Server clock ahead of terminal | Irrelevant: the terminal trusts 401s over its own clock. |
| Two terminals registered as `T1` | Impossible — `@@unique([storeId, terminalId])`; the second registration supersedes the first. |
| Store deleted | FK on `storeId` removes the terminal rows with it. |

## 7. Test plan

Pure/unit:

- Token parse and compare: valid, unknown uuid, wrong secret, malformed (no `.`), timing-safe path.
- Renewal window: rotates inside 30 days, does not rotate outside it, extends `expiresAt`.
- `validateUser` branch: valid terminal, revoked terminal, terminal id that no longer exists.

Integration (staging, `dev` branch):

1. Register a terminal as ADMIN, and again as SUPER_ADMIN with `storeId` in the body.
2. Refresh, then call `/sales/sync` and `/smena/sync-bulk` with the terminal access token.
3. Confirm `GET /suppliers` and `GET /users/sync` pass, and that an ADMIN-only endpoint
   (`POST /products/sync-bulk`) still refuses the terminal token.
4. Revoke → the next refresh 403s, and a live access token stops working within the hour.
5. Re-register the same `terminalId` → the old token 401s.
6. Full offline day: sell on PIN logins only with the network down, then reconnect and confirm
   every sale and the closed shift land.

## 8. Rollout

1. **Server first.** `ValidationPipe` runs with `forbidNonWhitelisted: true`, so a POS build that
   sends a field the server does not know gets a 400 on every request. Deploy the migration and
   the endpoints to `dev`, verify, then merge to `main`.
2. **POS second.** Registration on setup and on admin login; `ensureServerToken()` behind the
   existing user-token fallback, so a terminal that fails to register behaves exactly as today.
3. **Watch** `lastSeenAt` in the dashboard until every terminal has registered.
4. **Then** retire the persisted `server_token` path and, if wanted, the password login on the
   terminal.

## 9. Decisions I need from you

1. **Terminal token lifetime** — 180 days sliding, or no expiry at all with revocation as the only
   kill switch? Sliding is safer; never-expiring is one less thing to explain to a shop.
2. **Access token TTL** — 1h assumed. Shorter narrows a leak, longer costs less on a bad link.
3. **Does a terminal ever need to upload master data?** The spec says no. If an admin working on
   the POS should still push products while `posAdminLocked` is false, that keeps working today
   through their own user token, and this changes nothing — but confirm that is the intent.


implement it, 180 days sliding, 1h TTL, no master data from terminal