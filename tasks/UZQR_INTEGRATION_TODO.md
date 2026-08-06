# TODO — UzQR / QR-code payment integration (REGOS:VCR)

> Source of truth: `tasks/REGOS_API_INTERFACE_UPDATED.md` (replaces the deleted `REGOS_API_INTERFACE.MD`).
> Companion guide: `tasks/REGOS_VCR_INTEGRATION.md`.
> Scope decided 2026-07-21: **UzQR only** (`payment_system_id = 5`), QR shown **on-screen in the POS UI**, and **also refresh** the non-UzQR interface deltas (error codes, `ValidatePosition`, `card_type` social). Token EPS apps (Click PASS / Payme GO / Uzum Pay / Paynet Pass / Anor) and integrated bank-terminal acquiring are **out of scope** for now.

---

## 0. Background — what actually changed in the API

The UPDATED interface reworks `Payment.Create` / `Payment.Get` / `Payment.Cancel` and adds a QR path:

- `payment_system_id = 5` → **UzQR**. `token` is NOT sent. VCR creates a QR-invoice and returns **`qr_text`** (the string/URL to render as a QR for the buyer) + **`invoice_id`**.
- Payment confirms **asynchronously** in the buyer's app. Caller must **poll `Payment.Get`** until `status = 3` (paid). `Payment.Get` also syncs status with the payment system and updates any VCR-configured QR device.
- After payment, `rrn` holds the **UzQR payment identifier**.
- The local VCR payment `id` is then passed to `Receipt.Sale` → `payments[].payment_id` (as a `type = 2` payment). UzQR is booked as a **cashless card payment**; its id is used as RRN.
- New response fields across `Payment.*`: **`qr_text`**, **`invoice_id`**, **`card_number`** (masked).
- `Payment.Cancel` for QR is only possible **before** the buyer pays.

Constraints to respect (from Receipt.Sale): only **one** `Payment.Create`-backed payment per receipt; only in a **sale** receipt (not refund/advance/credit); a payment already linked to another receipt cannot be reused; **max one `type = 2`** payment object per receipt.

**Current code baseline** (`src/main/fiscal/regos-vcr-client.ts`, `regos-vcr-service.ts`):
- Client implements only: `Sys.*`, `ZReport.*`, `Receipt.ValidateSale/Sale/CheckQRcodeUrl/Duplicate/FullRefund/GetInfo`. **No `Payment.*`.**
- `buildPayments()` books card as `{ type: 2, value, card_type: 2 }` with **no `payment_id`** (plain bank terminal, per the 2026-06-04 decision). UzQR is **additive** — it does NOT replace this; cash and plain-card stay as-is.

---

## 1. Client layer — add `Payment.*` to `RegosVcrClient`

File: `src/main/fiscal/regos-vcr-client.ts`

- [ ] Add types:
  - `VcrPaymentStatus` (enum/const — confirm exact codes; observed: `2` = pending/awaiting, `3` = paid; verify the full set against a live/test run).
  - `VcrPaymentResult` = `{ id, datetime, payment_system_id, payment_id, status, amount, receipt_id, phone, rrn, slip, card_type_id, card_number?, invoice_id?, qr_text? }`.
- [ ] Extend `VcrPayment` interface: allow the UzQR shape `{ type: 2, payment_id }` **without** `value` (Receipt.Sale example for a Payment.Create-backed payment omits `value`). Confirm whether `value` must be omitted or may be sent — test both.
- [ ] Add `card_type` value `3` (social) to the union (already `1 | 2 | 3` — OK, just document social).
- [ ] Add methods:
  - `createPayment({ payment_system_id: 5, amount, description? })` → `VcrPaymentResult` (returns `qr_text`, `invoice_id`, `status`).
  - `getPayment(paymentId)` → `VcrPaymentResult`.
  - `cancelPayment(paymentId)` → `null`.
- [ ] Use a **longer timeout** for `Payment.*` (docs recommend ~180 s for terminal/token; for UzQR the create is fast but be generous). Keep the single-threaded "await each call" rule.

---

## 2. UzQR payment orchestration (main process)

New file suggestion: `src/main/fiscal/uzqr-payment.ts` (or a method group on `RegosVcrService`).

- [ ] `startUzQrPayment(amountTiyin, description)`:
  - Call `createPayment` → get `{ id, qr_text, invoice_id, status }`.
  - Return `{ vcrPaymentId, qrText, status }` to the renderer.
- [ ] `pollUzQrPayment(vcrPaymentId, { intervalMs, timeoutMs })`:
  - Loop `getPayment` until `status = 3` (paid), a terminal failure status, or timeout.
  - Poll interval ~2 s; overall timeout configurable (e.g. 120 s) with cancel support.
  - Return final `{ status, rrn, paymentId }`.
  - Must remain sequential vs. other VCR calls (VCR is single-threaded — serialize with the same in-flight guard the service uses for sale/refund).
- [ ] `cancelUzQrPayment(vcrPaymentId)` — call `cancelPayment`; tolerate "already paid / already linked" errors (704036 etc.).
- [ ] On success, hand the local `vcrPaymentId` to the existing sale path so `Receipt.Sale` includes `payments: [{ type: 2, payment_id: vcrPaymentId }]`.
  - **Decision needed at build time:** whether to also send `value` for the UzQR payment, and how it coexists with a split (e.g. part cash + UzQR). MVP: UzQR as the **sole** tender for the receipt.

---

## 3. `buildPayments` / sale wiring

File: `src/main/fiscal/regos-vcr-service.ts` (`buildPayments`, and the `fiscalizeSale` path ~L518)

- [ ] Introduce a `UZQR` payment method (or a `regosPaymentId` field on the sale) so `buildPayments` can emit the `{ type: 2, payment_id }` UzQR shape instead of the plain `{ type: 2, value, card_type: 2 }` card shape.
- [ ] Guard the constraints: exactly one `Payment.Create`-backed payment, sale-only, not reused.
- [ ] Ensure `Receipt.ValidateSale` still runs before `Receipt.Sale` for UzQR (payments now non-empty; keep `ignore_payments: false`).
- [ ] Confirm the RRN/`payment_id` is persisted with the sale so the Receipt Details modal (`buildReceiptDetails` ~L436) shows the exact body sent.

---

## 4. Data model / persistence

- [ ] Decide storage for the UzQR link on a sale (SQLite `prisma/schema.sqlite.prisma`):
  - `regosPaymentId` (VCR local payment uuid) and optionally `regosPaymentRrn` (UzQR id).
  - Follow the SQLite flow: edit schema → `npx prisma db push --schema prisma/schema.sqlite.prisma` → `npm run prisma:generate:sqlite`.
- [ ] Add a `paymentMethod` value `UZQR` (or equivalent) wherever payment methods are enumerated (`src/shared/types/`, reports, Z-report tallies).
- [ ] Server side (`prisma/schema.prisma`) only if UzQR sales need to sync/report distinctly — mirror the field, migrate via `prisma:migrate:dev`. (Server-only change → no app version bump on its own.)

---

## 5. Renderer / UI — on-screen QR (customer scans)

- [ ] New checkout tender **"UzQR"** alongside Cash / Card in the checkout modal and POS quick-pay.
- [ ] UzQR flow modal:
  1. Cashier picks UzQR → main calls `startUzQrPayment(total)`.
  2. Render `qr_text` as a **QR code on screen** (reuse the QR lib already used for the OFD receipt QR in `src/main/printer/thermal-printer.ts` / renderer — check what's available; may need a renderer-side QR component).
  3. Show a "waiting for payment…" state; renderer subscribes to poll results (IPC event or polling call).
  4. On `status = 3` → proceed to `Receipt.Sale` with the `payment_id`, then normal receipt print.
  5. On timeout / failure → offer retry or cancel (`cancelUzQrPayment`), keep cart intact.
- [ ] IPC plumbing (follow the existing pattern: `preload.ts` → `ipc-client.ts` → hook → view):
  - `uzqr:start`, `uzqr:status` (or a push event), `uzqr:cancel`.
  - Namespaced under `window.electronAPI` (never call `ipcRenderer` directly).
- [ ] i18n: add RU + UZ strings (`src/renderer/i18n/locales/ru.json`, `uz.json`) for the UzQR tender, waiting/paid/failed states, "Отсканируйте QR для оплаты" / "To'lov uchun QR kodni skanerlang".

---

## 6. Non-UzQR interface refresh (bundled per decision)

- [ ] **Error-code map** (`describeVcrError` / `VCR_ERROR_HINTS` in `regos-vcr-client.ts`): add the new codes from the UPDATED "Список ошибок":
  - Payment: `704034` (система не поддерживается), `704035` (не указан ID платежа), `704036` (отмена невозможна — чек закрыт), `704037` (не указан ID чека продажи), `704038` (система не активна), `704039` (доп. типы чеков не активны), `704040` (ошибка выполнения платежа).
  - EPS services: `705700/705701` PaymeGo, `705720/705721` ClickPass, `705730/705731` UzumPay, `705740/705741` AnorGo, `705750/705751` NIC API.
  - Terminal/Arccom: `705520–705526`.
  - Shift: `704100` (смена уже открыта), `704101` (нет открытой смены) — reconcile with existing `704010/704011` handling.
- [ ] **`Receipt.ValidatePosition`** (if/when we add it): success now returns `result: true` (not empty). New input `is_sale` (default `true`; pass `false` for refund checks). `package_code` optional (VCR infers from ICPS). Note: not currently called — add only if we start pre-validating marked positions.
- [ ] **`card_type = 3` (social)** and **`card_type_id = 0` (not set)** — document/support if social cards become relevant.
- [ ] **`ignore_payments` default flipped `true → false`** in ValidateSale/ValidateRefund — current code always passes it explicitly, so **no change needed**; note it so nobody relies on the default.
- [ ] **Max one `type = 2` payment** (docs tightened from two) — current code sends one; keep it that way. Add an assertion if we ever build split payments.

---

## 7. Testing

- [ ] Extend the harness `scripts/regos-vcr-test.ts` (`npm run test:regos-vcr -- <cmd>`) with `uzqr` commands: `payment-create`, `payment-get`, `payment-cancel`, and a full "create → poll → sale" dry run.
- [ ] **Blocker to confirm with REGOS:** is there a **test `payment_system_id = 5` / UzQR sandbox** on `vcr-test.regos.uz`? The integration guide notes there were **no test keys for ЭПС** and `Payment.*` needed real hardware/tokens as of 2026-06-04. Verify UzQR can be exercised on the test stand before committing UI work — otherwise plan a staged rollout tested on a real terminal.
- [ ] Verify the full status lifecycle values (what non-`3` statuses mean: pending `2`, cancelled, failed) against live responses; the docs only show `2` and `3` explicitly.
- [ ] End-to-end on staging build (`.env.pos VPS_API_URL=https://dev.pos.bobur-dev.uz`) → confirm sale with UzQR persists `payment_id`/RRN and prints the OFD QR receipt.

---

## 8. Open questions to resolve before/while building

- [ ] Does `vcr-test.regos.uz` support UzQR test payments, or is a real terminal required? (gates §7)
- [ ] Exact `status` enum for `Payment.Get` (full set + which are terminal-failure).
- [ ] For UzQR, does `Receipt.Sale` want `payments[].value` present alongside `payment_id`, or `payment_id` alone?
- [ ] Split tenders (cash + UzQR) — needed for MVP, or UzQR-only-per-receipt to start? (Affects §2/§3.)
- [ ] QR display surface: single operator screen vs. a separate customer-facing display — do any deployed terminals have a second screen?

---

## 9. Housekeeping

- [x] Delete old `tasks/REGOS_API_INTERFACE.MD` (superseded by `REGOS_API_INTERFACE_UPDATED.md`).
- [ ] Version bump: this touches renderer + main + IPC → **minor** bump in `package.json` at deploy time (per `version_bump_at_deploy` memory: bump once when ready to deploy, then `npm run deploy:pos`).
- [ ] Update `REGOS_VCR_INTEGRATION.md`'s "integrated acquiring is OPTIONAL / do NOT build Payment.*" decision box to note UzQR is now an approved exception.

---

## Review (fill in after implementation)

_TBD_
