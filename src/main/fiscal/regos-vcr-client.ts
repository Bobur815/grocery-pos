// REGOS:VCR JSON-RPC client (main process). Talks to the locally-installed
// REGOS:VCR app over HTTP. Promoted from scripts/regos-vcr-test.ts (proven against
// vcr-test.regos.uz). VCR is single-threaded — callers must await each call.

import { recordVcrCall } from './fiscal-timing';

// Verbose VCR request/response logging — off unless FISCAL_DEBUG=true.
const VCR_DEBUG = process.env.FISCAL_DEBUG === 'true';

export interface VcrPosition {
  name: string;
  barcode: string;
  icps: string; // MXIK code (= product.mxik)
  amount: number; // total position price in tiyin (sum × 100)
  quantity: number; // qty × 1000
  vat_value: number; // VAT amount in tiyin
  discount: number; // tiyin
  package_code?: string;
  label?: string; // mandatory-marking DataMatrix code (marked goods)
  code?: string;
  unit_name?: string;
  group_name?: string;
  owner_type?: 'BuyingAndSelling' | 'Commission';
}

export interface VcrPayment {
  type: 1 | 2; // 1 = cash, 2 = card/terminal
  /**
   * Tiyin. Optional ONLY because a Payment.Create-backed payment (UzQR) is booked by reference:
   * VCR already holds the amount against `payment_id`, and restating it risks a mismatch. Every
   * other payment shape must set it — see buildPayments(), the only producer.
   */
  value?: number;
  payment_id?: string;
  card_type?: 1 | 2 | 3; // 1 = ?, 2 = bank card, 3 = social
  rrn?: string;
}

/**
 * A VCR payment (Payment.Create / Get / Cancel).
 *
 * `status` is only partially documented: 2 = awaiting the buyer, 3 = paid. The rest of the enum
 * is unconfirmed, which is why nothing here treats "not 3" as failure — see UZQR_PAID.
 */
export interface VcrPaymentResult {
  id: string;
  status: number;
  amount: number;
  datetime?: string;
  payment_system_id?: number;
  payment_id?: string;
  receipt_id?: string;
  phone?: string;
  /** UzQR payment identifier, present once paid. */
  rrn?: string;
  slip?: string;
  card_type_id?: number;
  /** Masked, e.g. "8600****1234". */
  card_number?: string;
  invoice_id?: string;
  /** The string to render as a QR code for the buyer to scan. */
  qr_text?: string;
}

/** The only status REGOS documents as "paid". Everything else keeps polling. */
export const UZQR_PAID = 3;

/** UzQR in REGOS's payment-system table. */
export const UZQR_PAYMENT_SYSTEM_ID = 5;

export interface VcrReceiptResult {
  Id: string;
  Amount: number;
  QRCodeURL: string;
  TerminalID: string;
  ReceiptNo: string;
  DateTime: string;
  FiscalSign: string;
}

export interface VcrSysInfo {
  TerminalID: string;
  CurrentReceiptSeq: string;
  CurrentTime: string;
  ReceiptCount: number;
  ReceiptMaxCount: number;
  ZReportCount: number;
  ZReportMaxCount: number;
  AppletVersion: string;
}

export interface VcrZReportInfo {
  TerminalID: string;
  Number: number;
  Count: number;
  OpenTime: string;
  CloseTime: string;
  // Totals for the current Z-report — all amounts are ×100 (tiyin).
  TotalSaleCount: number;
  TotalSaleCash: number;
  TotalSaleCard: number;
  TotalSaleVat: number;
  TotalRefundCount: number;
  TotalRefundCash: number;
  TotalRefundCard: number;
  TotalRefundVat: number;
}

export class VcrError extends Error {
  constructor(
    public readonly code: number,
    public readonly description: string,
    public readonly method: string,
  ) {
    super(`VCR [${code}] ${method}: ${description}`);
    this.name = 'VcrError';
  }
}

interface VcrResponse<T> {
  id: number;
  ok: boolean;
  result: T | { error: number; description: string };
  jsonrpc: '2.0';
}

export class RegosVcrClient {
  private requestId = 1;
  private readonly authToken: string;

  constructor(
    private readonly baseUrl: string,
    login: string,
    password: string,
    private readonly timeoutMs = 30_000,
  ) {
    this.authToken = Buffer.from(`${login}:${password}`).toString('base64');
  }

  private async call<T>(method: string, params: unknown = null): Promise<T> {
    // Timed in a finally so failures count too — a 30s timeout is the single most informative
    // sample there is, and dropping it would make the device look faster than it is.
    const startedAt = performance.now();
    try {
      return await this.callImpl<T>(method, params);
    } finally {
      recordVcrCall(method, performance.now() - startedAt);
    }
  }

  private async callImpl<T>(method: string, params: unknown = null): Promise<T> {
    const id = this.requestId++;
    const payload = { id, jsonrpc: '2.0' as const, method, params, auth: this.authToken };
    // Verbose request/response logging — enable with FISCAL_DEBUG=true for field support.
    if (VCR_DEBUG) console.log(`[VCR →] ${method}`, JSON.stringify({ ...payload, auth: '***' }));

    let res: Response;
    try {
      res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json;charset=utf-8' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      // Network/timeout — VCR app not reachable. Surface as a VcrError with code 0.
      console.error(`[VCR ←] ${method} NETWORK ERROR:`, e instanceof Error ? e.message : e);
      throw new VcrError(0, e instanceof Error ? e.message : 'VCR unreachable', method);
    }

    const text = await res.text();
    if (VCR_DEBUG) console.log(`[VCR ←] ${method} (HTTP ${res.status}): ${text}`);

    let data: VcrResponse<T>;
    try {
      data = JSON.parse(text) as VcrResponse<T>;
    } catch {
      throw new VcrError(res.status, `Non-JSON response: ${text.slice(0, 200)}`, method);
    }

    if (!data.ok) {
      const err = data.result as { error: number; description: string };
      throw new VcrError(err?.error ?? 0, err?.description ?? 'Unknown VCR error', method);
    }
    return data.result as T;
  }

  // ── System (non-printing) ──────────────────────────────────────────────────
  initialize() { return this.call<VcrSysInfo>('Sys.Initialize'); }
  getInfo() { return this.call<VcrSysInfo>('Sys.GetInfo'); }
  getOverflowInfo() {
    return this.call<{ AvaialableZReportCount: number; AvaialableUnsendReceiptCount: number }>(
      'Sys.GetOverflowInfo',
    );
  }

  // ── Z-report (shift) ────────────────────────────────────────────────────────
  zOpen() { return this.call<{ id: number; open_time: string; close_time: null }>('ZReport.Open'); }
  zClose() { return this.call<{ id: number; open_time: string; close_time: string }>('ZReport.Close'); }
  zGetInfo(print = false) { return this.call<VcrZReportInfo>('ZReport.GetInfo', { PrintReceipt: print }); }

  // ── Receipts ──────────────────────────────────────────────────────────────
  validateSale(positions: VcrPosition[], payments: VcrPayment[], ignorePayments = false) {
    return this.call<{ validate: boolean } | null>('Receipt.ValidateSale', {
      receipt: { positions, payments },
      ignore_payments: ignorePayments,
    });
  }

  sale(params: {
    positions: VcrPosition[];
    payments: VcrPayment[];
    code?: string;
    cashier_name?: string;
    session_code?: string;
    pos_id?: string;
    phone?: string;
  }) {
    return this.call<VcrReceiptResult>('Receipt.Sale', params);
  }

  checkQrCodeUrl(qrCodeUrl: string) {
    return this.call<boolean>('Receipt.CheckQRcodeUrl', { QRCodeURL: qrCodeUrl });
  }

  /** Print a duplicate of an existing receipt by its VCR uuid. */
  duplicate(id: string) {
    return this.call<null>('Receipt.Duplicate', { id });
  }

  fullRefund(qrCodeUrl: string) {
    return this.call<VcrReceiptResult>('Receipt.FullRefund', { QRCodeURL: qrCodeUrl });
  }

  getReceiptInfo(params: { Id?: string; QRCodeURL?: string; ReceiptNo?: string; Code?: string }) {
    return this.call<(VcrReceiptResult & { Code: string }) | null>('Receipt.GetInfo', params);
  }

  // ── Payments (UzQR) ─────────────────────────────────────────────────────────

  /**
   * Create a payment invoice. For UzQR (`payment_system_id: 5`) VCR returns `qr_text` — the
   * string to render as a QR for the buyer — plus an `invoice_id`; no `token` is sent.
   *
   * The payment confirms ASYNCHRONOUSLY in the buyer's bank app, so this returning does NOT
   * mean money moved. Poll `getPayment` until the status is terminal.
   */
  createPayment(params: { payment_system_id: number; amount: number; description?: string }) {
    return this.call<VcrPaymentResult>('Payment.Create', params);
  }

  /** Re-reads a payment AND syncs its status with the payment system. Safe to poll. */
  getPayment(paymentId: string) {
    return this.call<VcrPaymentResult>('Payment.Get', { payment_id: paymentId });
  }

  /** Only possible BEFORE the buyer pays; afterwards VCR answers 704036. */
  cancelPayment(paymentId: string) {
    return this.call<null>('Payment.Cancel', { payment_id: paymentId });
  }
}

/**
 * Turn a raw VCR error (numeric code + REGOS's Russian description) into a concise,
 * staff-friendly Russian message. Falls back to REGOS's own description when no
 * specific mapping matches (it is already Russian and meaningful).
 */
export function describeVcrError(code: number, description: string): string {
  const d = description || '';
  if (/обязательной маркировки не задан/i.test(d)) return 'Не отсканирован код маркировки (Asl-Belgisi)';
  if (/недействительн/i.test(d)) return 'Код маркировки недействителен (товар вне оборота)';
  if (/не разреш'?ё?нные символы|не разрешен/i.test(d)) return 'Код маркировки содержит недопустимые символы';
  if (/маркировк/i.test(d)) return 'Неверный код маркировки — проверьте DataMatrix товара';
  if (/Ставка НДС/i.test(d)) return 'Неверная ставка НДС для товара';
  if (/ИКПУ|МХИК|icps/i.test(d)) return 'Неверный код МХИК (ИКПУ) товара';
  if (code === 704020) return 'Фискальная смена пуста — закрывать нечего';
  if (code === 0) return 'Нет связи с виртуальной кассой (REGOS:VCR)';
  if (code === 705000) return 'Неверный логин или пароль кассира';
  if (VCR_ERROR_HINTS[code]) return VCR_ERROR_HINTS[code];
  return d || `Ошибка ВКМ (${code})`;
}

/** Human-readable hints for the common VCR error codes (RU surfaced to staff). */
export const VCR_ERROR_HINTS: Record<number, string> = {
  0: 'Виртуальная касса недоступна — проверьте, запущено ли приложение REGOS:VCR',
  701003: 'Некорректные данные чека (проверьте МХИК, НДС, суммы)',
  703000: 'Неверный формат запроса',
  704006: 'Фискальный модуль заблокирован — обратитесь в ЦТО (ТХКМ)',
  704010: 'Z-отчёт не открыт — откройте смену',
  704011: 'Z-отчёт уже открыт',
  704017: 'Фискальный модуль не найден — проверьте USB',
  704019: 'Нет связи с сервером времени 24ч — проверьте интернет',
  704025: 'Нет связи с сервером лицензий 24ч — проверьте интернет',
  704029: 'Имеется задолженность — обратитесь в ЦТО (ТХКМ)',
  705000: 'Неверный логин или пароль кассира',
  705002: 'Принтер не настроен в REGOS:VCR',
  705511: 'Ошибка проверки МХИК (ИКПУ) товара',

  // Shift codes from the UPDATED interface. Note 704100/704101 duplicate the meaning of the
  // older 704011/704010 above — REGOS ships both, so both are mapped rather than picking one.
  704100: 'Смена уже открыта',
  704101: 'Нет открытой смены — откройте смену',

  // Payment.* (UzQR and other payment systems)
  704034: 'Платёжная система не поддерживается',
  704035: 'Не указан ID платежа',
  704036: 'Отмена невозможна — платёж уже проведён или чек закрыт',
  704037: 'Не указан ID чека продажи',
  704038: 'Платёжная система не активна — включите её в REGOS:VCR',
  704039: 'Дополнительные типы чеков не активны',
  704040: 'Ошибка выполнения платежа',

  // Bank terminal / Arccom
  705520: 'Ошибка терминала оплаты',
  705521: 'Терминал оплаты не отвечает',
  705522: 'Операция отклонена терминалом',
  705523: 'Терминал занят другой операцией',
  705524: 'Неверная сумма для терминала оплаты',
  705525: 'Терминал не настроен',
  705526: 'Ошибка связи с банком',

  // EPS token apps (out of scope today, mapped so their errors are readable if they surface)
  705700: 'Ошибка Payme GO',
  705701: 'Payme GO недоступен',
  705720: 'Ошибка Click PASS',
  705721: 'Click PASS недоступен',
  705730: 'Ошибка Uzum Pay',
  705731: 'Uzum Pay недоступен',
  705740: 'Ошибка Anor GO',
  705741: 'Anor GO недоступен',
  705750: 'Ошибка NIC API',
  705751: 'NIC API недоступен',
};
