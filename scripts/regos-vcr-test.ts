/**
 * REGOS:VCR test harness — exercises the fiscal VCR JSON-RPC API.
 *
 * Run with tsx (no build needed):
 *   npm run test:regos-vcr -- <command> [args]
 *   npx tsx scripts/regos-vcr-test.ts <command> [args]
 *
 * Credentials & target come from env (request test creds from REGOS: +998 55 501 00 30 / @regos_uzbot):
 *   VCR_URL        Base URL          (default: http://vcr-test.regos.uz)
 *   VCR_LOGIN      API user          (default: cassir — only this role has API access)
 *   VCR_PASSWORD   cassir password   (REQUIRED)
 *
 * Optional test-position overrides (defaults = the docs' proven non-marked item):
 *   VCR_ICPS, VCR_BARCODE, VCR_ARTICUL, VCR_NAME, VCR_UNIT, VCR_PACKAGE_CODE, VCR_LABEL,
 *   VCR_PRICE_SUM (default 90 sum), VCR_QTY (default 1), VCR_VAT_SUM (default 12 sum)
 *   VAT is product-specific (looked up by icps in the tax registry, not a % of amount).
 *   Marked goods (most beverages/dairy) also require VCR_LABEL = a real DataMatrix code.
 *
 * Commands (covers all 22 documented API methods):
 *   all                Run the full software-testable suite + print a coverage summary
 *   info               Sys.Initialize + Sys.GetInfo + Sys.GetOverflowInfo   (does NOT print)
 *   validate           Receipt.ValidateSale on the test position
 *   validate-position  Receipt.ValidatePosition on the test position
 *   zinfo              ZReport.GetInfo (no print)
 *   zopen / zclose     ZReport.Open / ZReport.Close   (start / end a shift)
 *   sale               Ensure shift open → ValidateSale → Receipt.Sale → Receipt.GetInfo   (PRINTS)
 *   getinfo <arg>      Receipt.GetInfo by Id (uuid) / QRCodeURL (http) / ReceiptNo (digits) / Code
 *   duplicate <id>     Receipt.Duplicate of a receipt uuid                                  (PRINTS)
 *   checkqr <url>      Receipt.CheckQRcodeUrl — validate a QR URL format
 *   refund <QRCodeURL> Receipt.FullRefund by the sale's QR URL                              (PRINTS)
 *   validate-refund <qr>  Receipt.ValidateRefund for the given sale QR
 *   refund-partial <qr>   Receipt.ValidateRefund → Receipt.Refund (partial)                 (PRINTS)
 *   advance / credit   Receipt.Advance / Receipt.Credit (NOT fiscalized)                    (PRINTS)
 *   payment-create     Payment.Create (needs a payment terminal / EPS token)
 *   payment-get <id> / payment-cancel <id>   Payment.Get / Payment.Cancel
 *   acquiring-balance / acquiring-totals     Acquiring.Balance / Acquiring.Totals (need terminal)
 *   uzqr-create [sum]  Payment.Create with payment_system_id=5 — prints qr_text + invoice_id
 *   uzqr-get <id> / uzqr-cancel <id>   Payment.Get / Payment.Cancel for a UzQR invoice
 *   uzqr-flow [sum]    create → poll until paid (or UZQR_TIMEOUT_MS), printing every status.
 *                      Use this to map the undocumented Payment status enum against real data.
 *
 * NOTE: every method except Sys.Initialize/GetInfo/GetOverflowInfo prints on the VCR's
 * configured printer. On the test endpoint, watch the output at https://vcr-camera.regos.uz/.
 * VCR is single-threaded — this harness awaits each call before the next.
 */

import 'dotenv/config'; // load VCR_URL / VCR_LOGIN / VCR_PASSWORD from .env

// ─── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.VCR_URL ?? 'http://vcr-test.regos.uz';
const LOGIN = process.env.VCR_LOGIN ?? 'cassir';
const PASSWORD = process.env.VCR_PASSWORD ?? '';

const AUTH = Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');

// Test position. Defaults = the REGOS docs' Receipt.ValidateSale example, which we
// confirmed validates on the test stand: a NON-marked item, no package_code/label.
// The VAT amount is product-specific (the FDA resolves the rate from the icps), so we
// send it explicitly rather than computing a % of amount. Override any field via env.
const PRICE_SUM = Number(process.env.VCR_PRICE_SUM ?? 90); // price per unit, in sum
const QTY = Number(process.env.VCR_QTY ?? 1); // units (1 = 1pc, 0.5 = 500g)
const VAT_SUM = Number(process.env.VCR_VAT_SUM ?? 12); // VAT amount per position, in sum

const TEST_POSITION = {
  name: process.env.VCR_NAME ?? 'Heinz Yabloko (TEST)',
  barcode: process.env.VCR_BARCODE ?? '5449000000996',
  articul: process.env.VCR_ARTICUL ?? '5449000000996',
  icps: process.env.VCR_ICPS ?? '02004001004002007',
  package_code: process.env.VCR_PACKAGE_CODE ?? '', // optional; required for marked goods
  label: process.env.VCR_LABEL ?? '', // mandatory marking (DataMatrix) code — marked goods only
  unit_name: process.env.VCR_UNIT ?? 'шт',
};

// ─── Money / quantity helpers (see REGOS rules: tiyin = sum×100, qty ×1000) ──────

const toTiyin = (sum: number) => Math.round(sum * 100);
const toQty = (units: number) => Math.round(units * 1000);

// ─── Error code map (subset from the integration guide) ──────────────────────────

const ERROR_HINTS: Record<number, string> = {
  701003: 'Invalid input data — check field values (see description)',
  703000: 'Malformed request',
  704006: 'Fiscal module BLOCKED — contact service center (TXKM)',
  704010: 'Z-report not open — run `zopen` first',
  704011: 'Z-report already open',
  704017: 'Fiscal module not found — check USB',
  704019: '24h time-server sync failure — check internet',
  704025: '24h license sync failure — check internet',
  704029: 'Debt exists — customer must settle with TXKM',
  705000: 'Wrong login/password — check VCR_LOGIN / VCR_PASSWORD',
  705002: 'Printer not configured in VCR settings',
  705511: 'MXIK (ICPS) invalid — fix VCR_ICPS / VCR_PACKAGE_CODE',
};

// ─── JSON-RPC client ─────────────────────────────────────────────────────────────

let requestId = 1;

interface VcrResponse<T> {
  id: number;
  ok: boolean;
  result: T | { error: number; description: string };
  jsonrpc: '2.0';
}

async function call<T = unknown>(method: string, params: unknown = null): Promise<T> {
  const id = requestId++;
  const body = JSON.stringify({ id, jsonrpc: '2.0', method, params, auth: AUTH });

  console.log(`\n→ [${id}] ${method}`);
  if (params !== null) console.log('  params:', JSON.stringify(params));

  let res: Response;
  try {
    res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body,
    });
  } catch (e) {
    throw new Error(`Network error calling ${method}: ${e instanceof Error ? e.message : String(e)}`);
  }

  const text = await res.text();
  let data: VcrResponse<T>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status} non-JSON response from ${method}: ${text.slice(0, 300)}`);
  }

  if (!data.ok) {
    const err = data.result as { error: number; description: string };
    const hint = ERROR_HINTS[err?.error] ? ` — ${ERROR_HINTS[err.error]}` : '';
    console.error(`✗ [${id}] ${method} FAILED: [${err?.error}] ${err?.description}${hint}`);
    throw new VcrError(err?.error ?? 0, err?.description ?? 'Unknown VCR error', method);
  }

  console.log(`✓ [${id}] ${method} ok`);
  console.log('  result:', JSON.stringify(data.result, null, 2));
  return data.result as T;
}

class VcrError extends Error {
  constructor(public code: number, public description: string, public method: string) {
    super(`VCR [${code}] ${method}: ${description}`);
    this.name = 'VcrError';
  }
}

// ─── Test position / receipt builders ────────────────────────────────────────────

function buildPosition() {
  const amount = toTiyin(PRICE_SUM * QTY);
  const pos: Record<string, unknown> = {
    name: TEST_POSITION.name,
    barcode: TEST_POSITION.barcode,
    articul: TEST_POSITION.articul,
    icps: TEST_POSITION.icps,
    unit_name: TEST_POSITION.unit_name,
    amount,
    quantity: toQty(QTY),
    vat_value: toTiyin(VAT_SUM),
    discount: 0,
    owner_type: 'BuyingAndSelling' as const,
  };
  // Optional fields — only sent when present (package_code/label required for marked goods).
  if (TEST_POSITION.package_code) pos.package_code = TEST_POSITION.package_code;
  if (TEST_POSITION.label) pos.label = TEST_POSITION.label;
  return pos;
}

function buildSaleParams(code: string) {
  const position = buildPosition();
  return {
    code, // idempotency key — your internal receipt id
    pos_id: 'posgro-test',
    session_code: 'posgro-test-shift',
    cashier_name: 'posgro test harness',
    positions: [position],
    payments: [{ type: 1 as const, value: position.amount }], // full cash
  };
}

// ─── Commands ──────────────────────────────────────────────────────────────────

async function cmdInfo() {
  await call('Sys.Initialize');
  await call('Sys.GetInfo');
  const overflow = await call<{ AvaialableZReportCount: number; AvaialableUnsendReceiptCount: number }>(
    'Sys.GetOverflowInfo',
  );
  if (overflow.AvaialableZReportCount < 10) console.warn('⚠ Z-report memory low — contact TXKM');
  if (overflow.AvaialableUnsendReceiptCount < 20) console.warn('⚠ Unsent-receipt buffer nearly full — check internet');
}

async function cmdValidate() {
  const position = buildPosition();
  await call('Receipt.ValidateSale', {
    receipt: { positions: [position], payments: [{ type: 1, value: position.amount }] },
    ignore_payments: false,
  });
}

async function cmdZInfo() {
  await call('ZReport.GetInfo', { PrintReceipt: false });
}

async function cmdZOpen() {
  await call('ZReport.Open');
}

async function cmdZClose() {
  await call('ZReport.Close');
}

/** Ensure a shift is open; ZReport.GetInfo has empty OpenTime when closed. */
async function ensureShiftOpen() {
  const info = await call<{ OpenTime: string; CloseTime: string }>('ZReport.GetInfo', { PrintReceipt: false });
  const open = info.OpenTime && info.OpenTime.trim().length > 0 && (!info.CloseTime || info.CloseTime.trim() === '');
  if (!open) {
    console.log('  (no open shift — opening one)');
    await call('ZReport.Open');
  }
}

async function cmdSale() {
  await ensureShiftOpen();

  const position = buildPosition();
  await call('Receipt.ValidateSale', {
    receipt: { positions: [position], payments: [{ type: 1, value: position.amount }] },
    ignore_payments: false,
  });

  const code = `posgro-test-${Date.now()}`;
  const sale = await call<{ Id: string; QRCodeURL: string; FiscalSign: string; ReceiptNo: string }>(
    'Receipt.Sale',
    buildSaleParams(code),
  );

  await call('Receipt.GetInfo', { Id: sale.Id });

  console.log('\n────────────────────────────────────────────────────────');
  console.log('SALE COMPLETE. Save these for refund/records:');
  console.log(`  code       : ${code}`);
  console.log(`  Id         : ${sale.Id}`);
  console.log(`  ReceiptNo  : ${sale.ReceiptNo}`);
  console.log(`  FiscalSign : ${sale.FiscalSign}`);
  console.log(`  QRCodeURL  : ${sale.QRCodeURL}`);
  console.log('To refund:  npm run test:regos-vcr -- refund "' + sale.QRCodeURL + '"');
  console.log('Verify QR at ofd.soliq.uz · watch print at https://vcr-camera.regos.uz/');
  console.log('────────────────────────────────────────────────────────');
}

async function cmdRefund(qrCodeUrl: string) {
  if (!qrCodeUrl) throw new Error('refund requires a QRCodeURL argument');
  await call('Receipt.CheckQRcodeUrl', { QRCodeURL: qrCodeUrl });
  await call('Receipt.FullRefund', { QRCodeURL: qrCodeUrl });
}

// ── Additional receipt methods ──────────────────────────────────────────────
async function cmdValidatePosition() {
  const p: Record<string, unknown> = { icps: TEST_POSITION.icps, barcode: TEST_POSITION.barcode };
  if (TEST_POSITION.package_code) p.package_code = TEST_POSITION.package_code;
  if (TEST_POSITION.label) p.label = TEST_POSITION.label;
  await call('Receipt.ValidatePosition', p);
}

/** Resolve which Receipt.GetInfo key the arg is: URL→QRCodeURL, uuid→Id, digits→ReceiptNo, else Code. */
async function cmdGetInfo(arg: string) {
  if (!arg) throw new Error('getinfo requires an Id, QRCodeURL, ReceiptNo or Code');
  const key = arg.startsWith('http')
    ? 'QRCodeURL'
    : arg.includes('-')
    ? 'Id'
    : /^\d+$/.test(arg)
    ? 'ReceiptNo'
    : 'Code';
  await call('Receipt.GetInfo', { [key]: arg });
}

async function cmdDuplicate(id: string) {
  if (!id) throw new Error('duplicate requires a receipt Id (uuid)');
  await call('Receipt.Duplicate', { id });
}

async function cmdCheckQr(url: string) {
  if (!url) throw new Error('checkqr requires a QRCodeURL');
  await call('Receipt.CheckQRcodeUrl', { QRCodeURL: url });
}

function buildRefundReceipt(qr: string) {
  const position = buildPosition();
  return {
    code: `posgro-test-refund-${Date.now()}`,
    pos_id: 'posgro-test',
    cashier_name: 'posgro test harness',
    positions: [position],
    payments: [{ type: 1 as const, value: position.amount }],
    refund_info: { QRCodeURL: qr }, // if QRCodeURL is set, other refund_info fields are ignored
  };
}

async function cmdValidateRefund(qr: string) {
  if (!qr) throw new Error('validate-refund requires the original sale QRCodeURL');
  await call('Receipt.ValidateRefund', { receipt: buildRefundReceipt(qr), ignore_payments: false });
}

async function cmdRefundPartial(qr: string) {
  if (!qr) throw new Error('refund-partial requires the original sale QRCodeURL');
  await call('Receipt.ValidateRefund', { receipt: buildRefundReceipt(qr), ignore_payments: false });
  await call('Receipt.Refund', buildRefundReceipt(qr));
}

async function cmdAdvance() {
  await ensureShiftOpen();
  const position = buildPosition();
  await call('Receipt.Advance', {
    code: `posgro-test-adv-${Date.now()}`,
    pos_id: 'posgro-test',
    cashier_name: 'posgro test harness',
    positions: [position],
    payments: [{ type: 1, value: position.amount }],
  });
}

async function cmdCredit() {
  await ensureShiftOpen();
  const position = buildPosition();
  await call('Receipt.Credit', {
    code: `posgro-test-cr-${Date.now()}`,
    pos_id: 'posgro-test',
    cashier_name: 'posgro test harness',
    positions: [position],
    payments: [{ type: 1, value: position.amount }],
  });
}

// ── Payments / acquiring (need a real terminal or EPS token) ─────────────────
async function cmdPaymentCreate() {
  await call('Payment.Create', {
    payment_system_id: -1, // Ingenico terminal; -2 = PAX; >0 = EPS (needs token)
    card_type: 2,
    amount: toTiyin(PRICE_SUM * QTY),
    description: 'posgro test',
  });
}
async function cmdPaymentGet(id: string) {
  if (!id) throw new Error('payment-get requires a payment_id');
  await call('Payment.Get', { payment_id: id });
}
async function cmdPaymentCancel(id: string) {
  if (!id) throw new Error('payment-cancel requires a payment_id');
  await call('Payment.Cancel', { payment_id: id });
}
// ── UzQR (payment_system_id = 5) ─────────────────────────────────────────────
// Unlike the terminal/EPS commands above, UzQR needs no token and no hardware: VCR returns a
// qr_text the buyer scans in their bank app.

const UZQR_PAYMENT_SYSTEM_ID = 5;
const UZQR_PAID = 3;

async function cmdUzqrCreate(amountSum?: string) {
  const sum = amountSum ? Number(amountSum) : PRICE_SUM * QTY;
  const res = await call<{ id: string; qr_text?: string; invoice_id?: string; status: number }>(
    'Payment.Create',
    {
      payment_system_id: UZQR_PAYMENT_SYSTEM_ID,
      amount: toTiyin(sum),
      description: 'posgro uzqr test',
    },
  );
  console.log(`\npayment_id: ${res.id}`);
  console.log(`invoice_id: ${res.invoice_id ?? '(none)'}`);
  console.log(`qr_text   : ${res.qr_text ?? '(none — UzQR may not be enabled on this stand)'}`);
  return res;
}

async function cmdUzqrGet(id: string) {
  if (!id) throw new Error('uzqr-get requires a payment_id');
  await call('Payment.Get', { payment_id: id });
}

async function cmdUzqrCancel(id: string) {
  if (!id) throw new Error('uzqr-cancel requires a payment_id');
  await call('Payment.Cancel', { payment_id: id });
}

/**
 * Create an invoice and poll it, printing each status so the (undocumented) enum can be mapped
 * against real responses. Does NOT create a receipt — cancel or let it lapse when done.
 */
async function cmdUzqrFlow(amountSum?: string) {
  const created = await cmdUzqrCreate(amountSum);
  if (!created.qr_text) {
    console.log('\n⚠ No qr_text returned — nothing to scan. Aborting poll.');
    return;
  }

  const intervalMs = 2_000;
  const timeoutMs = Number(process.env.UZQR_TIMEOUT_MS ?? 120_000);
  const startedAt = Date.now();
  console.log(`\nPolling every ${intervalMs}ms for up to ${timeoutMs}ms — scan the QR now.`);

  for (;;) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const p = await call<{ status: number; rrn?: string }>('Payment.Get', {
      payment_id: created.id,
    });
    const elapsed = Date.now() - startedAt;
    console.log(`  [${Math.round(elapsed / 1000)}s] status=${p.status} rrn=${p.rrn ?? '-'}`);

    if (p.status === UZQR_PAID) {
      console.log(`\n✓ PAID — rrn=${p.rrn ?? '-'}, payment_id=${created.id}`);
      console.log('  Pass this payment_id to Receipt.Sale as payments[].payment_id (type 2).');
      return;
    }
    if (elapsed >= timeoutMs) {
      console.log('\n⏱ Timed out. Cancelling…');
      await cmdUzqrCancel(created.id).catch((e) => console.log(`  cancel failed: ${e.message}`));
      return;
    }
  }
}

async function cmdAcquiringBalance() {
  await call('Acquiring.Balance', { payment_system_id: '-2' });
}
async function cmdAcquiringTotals() {
  await call('Acquiring.Totals', { payment_system_id: '-1' });
}

// ── Full coverage suite ───────────────────────────────────────────────────────
async function cmdAll() {
  type Status = 'PASS' | 'FAIL' | 'SKIP';
  const results: Array<{ method: string; status: Status; note?: string }> = [];
  const step = async (method: string, fn: () => Promise<void>) => {
    try {
      await fn();
      results.push({ method, status: 'PASS' });
    } catch (e) {
      const note = e instanceof VcrError ? `[${e.code}] ${e.description}` : e instanceof Error ? e.message : String(e);
      results.push({ method, status: 'FAIL', note });
    }
  };
  const skip = (method: string, note: string) => results.push({ method, status: 'SKIP', note });

  await step('Sys.Initialize', async () => void (await call('Sys.Initialize')));
  await step('Sys.GetInfo', async () => void (await call('Sys.GetInfo')));
  await step('Sys.GetOverflowInfo', async () => void (await call('Sys.GetOverflowInfo')));
  await step('ZReport.GetInfo', async () => void (await call('ZReport.GetInfo', { PrintReceipt: false })));
  await step('ZReport.Open (ensure)', () => ensureShiftOpen());
  await step('Receipt.ValidatePosition', () => cmdValidatePosition());
  await step('Receipt.ValidateSale', () => cmdValidate());

  let saleId = '';
  let saleQr = '';
  await step('Receipt.Sale', async () => {
    const r = await call<{ Id: string; QRCodeURL: string }>('Receipt.Sale', buildSaleParams(`posgro-test-all-${Date.now()}`));
    saleId = r.Id;
    saleQr = r.QRCodeURL;
  });

  if (saleId) {
    await step('Receipt.GetInfo', async () => void (await call('Receipt.GetInfo', { Id: saleId })));
    await step('Receipt.Duplicate', async () => void (await call('Receipt.Duplicate', { id: saleId })));
  } else {
    skip('Receipt.GetInfo', 'no sale id'); skip('Receipt.Duplicate', 'no sale id');
  }
  if (saleQr) {
    await step('Receipt.CheckQRcodeUrl', async () => void (await call('Receipt.CheckQRcodeUrl', { QRCodeURL: saleQr })));
    await step('Receipt.ValidateRefund', () => cmdValidateRefund(saleQr));
    await step('Receipt.FullRefund', async () => void (await call('Receipt.FullRefund', { QRCodeURL: saleQr })));
  } else {
    skip('Receipt.CheckQRcodeUrl', 'no sale QR'); skip('Receipt.ValidateRefund', 'no sale QR'); skip('Receipt.FullRefund', 'no sale QR');
  }

  await step('Receipt.Advance', () => cmdAdvance());
  await step('Receipt.Credit', () => cmdCredit());

  // Hardware / stateful methods — not auto-runnable on the test stand
  skip('Receipt.Refund', 'partial refund — run `refund-partial <qr>` against a fresh sale');
  skip('Payment.Create', 'needs payment terminal (Ingenico/PAX) or EPS token');
  skip('Payment.Get', 'needs a payment_id from Payment.Create');
  skip('Payment.Cancel', 'needs a payment_id from Payment.Create');
  skip('Acquiring.Balance', 'needs Ingenico/PAX terminal');
  skip('Acquiring.Totals', 'needs Ingenico terminal');
  skip('ZReport.Close', 'run `zclose` manually — closes the shared test shift');

  console.log('\n════════════ API COVERAGE SUMMARY ════════════');
  for (const r of results) {
    const mark = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : '–';
    console.log(`  ${mark} ${r.status.padEnd(4)} ${r.method}${r.note ? ` — ${r.note}` : ''}`);
  }
  const c = (s: Status) => results.filter((r) => r.status === s).length;
  console.log(`\n  PASS ${c('PASS')} · FAIL ${c('FAIL')} · SKIP ${c('SKIP')}  (of 22 documented methods)`);
}

// ─── Entry point ─────────────────────────────────────────────────────────────────

async function main() {
  const [, , command = 'info', ...args] = process.argv;

  console.log('REGOS:VCR test harness');
  console.log(`  endpoint : ${BASE_URL}`);
  console.log(`  login    : ${LOGIN}`);
  console.log(`  command  : ${command}`);

  if (!PASSWORD) {
    console.error('\n✗ VCR_PASSWORD is not set. Request test credentials from REGOS and run e.g.:');
    console.error('   $env:VCR_PASSWORD="..."; npm run test:regos-vcr -- info   (PowerShell)');
    process.exit(1);
  }

  try {
    switch (command) {
      case 'info': await cmdInfo(); break;
      case 'validate': await cmdValidate(); break;
      case 'validate-position': await cmdValidatePosition(); break;
      case 'zinfo': await cmdZInfo(); break;
      case 'zopen': await cmdZOpen(); break;
      case 'zclose': await cmdZClose(); break;
      case 'sale': await cmdSale(); break;
      case 'getinfo': await cmdGetInfo(args[0]); break;
      case 'duplicate': await cmdDuplicate(args[0]); break;
      case 'checkqr': await cmdCheckQr(args[0]); break;
      case 'refund': await cmdRefund(args[0]); break;
      case 'validate-refund': await cmdValidateRefund(args[0]); break;
      case 'refund-partial': await cmdRefundPartial(args[0]); break;
      case 'advance': await cmdAdvance(); break;
      case 'credit': await cmdCredit(); break;
      case 'payment-create': await cmdPaymentCreate(); break;
      case 'payment-get': await cmdPaymentGet(args[0]); break;
      case 'payment-cancel': await cmdPaymentCancel(args[0]); break;
      case 'acquiring-balance': await cmdAcquiringBalance(); break;
      case 'acquiring-totals': await cmdAcquiringTotals(); break;
      case 'uzqr-create': await cmdUzqrCreate(args[0]); break;
      case 'uzqr-get': await cmdUzqrGet(args[0]); break;
      case 'uzqr-cancel': await cmdUzqrCancel(args[0]); break;
      case 'uzqr-flow': await cmdUzqrFlow(args[0]); break;
      case 'all': await cmdAll(); break;
      default:
        console.error(`Unknown command: ${command}`);
        console.error(
          'Commands: all | info | validate | validate-position | zinfo | zopen | zclose | sale |\n' +
          '          getinfo <id|qr|receiptNo|code> | duplicate <id> | checkqr <url> |\n' +
          '          refund <qr> | validate-refund <qr> | refund-partial <qr> | advance | credit |\n' +
          '          payment-create | payment-get <id> | payment-cancel <id> | acquiring-balance | acquiring-totals |\n' +
          '          uzqr-create [sum] | uzqr-get <id> | uzqr-cancel <id> | uzqr-flow [sum]',
        );
        process.exit(1);
    }
    console.log('\n✓ Done.');
  } catch (e) {
    if (e instanceof VcrError) {
      console.error(`\n✗ ${e.message}`);
    } else {
      console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
    }
    process.exit(1);
  }
}

void main();
