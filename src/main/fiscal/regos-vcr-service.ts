// REGOS:VCR fiscalization service (main process).
// Owns config, the sale → fiscal-receipt pipeline, Z-report (shift) mapping, and a
// background retry worker. Failure mode: "allow + fiscalize later" — sales complete
// locally with fiscal_status=PENDING and are fiscalized here (immediately or on retry).

import { getPrismaClient } from '../database/sqlite-client';
import { getAppConfig } from '../config/app-config';
import { getVcrPassword, hasVcrPassword, setVcrPassword } from './secret-store';
import { log } from '../logger';
import { normalizePollOptions } from './uzqr-poll';
import {
  RegosVcrClient,
  VcrError,
  describeVcrError,
  type VcrPosition,
  type VcrPayment,
  type VcrReceiptResult,
} from './regos-vcr-client';
import type {
  RegosVcrConfig,
  RegosVcrConfigInput,
  FiscalConnectionResult,
  FiscalQueueStatus,
  FiscalBulkResult,
  FiscalBulkProgress,
  FiscalLabel,
  FiscalZReportStatus,
  FiscalSalePreview,
  FiscalPreviewPosition,
  FiscalPreviewPayment,
} from '../../shared/types/fiscal.types';
import { repairCyrillicLayout, isLayoutCorrupted } from '../../shared/utils/keyboard-layout';
import { productRequiresMarking } from '../../shared/utils/marking';
import { toPieces } from '../../shared/utils/pack';
import { isCashTender } from '../../shared/constants';
import { isCodeOutOfCirculation } from '../marking/circulation-check';

const MAX_ATTEMPTS = 5; // cap retries for hard (business) failures
const FISCAL_DEBUG = process.env.FISCAL_DEBUG === 'true'; // verbose position/payment logs
const ERR_ZREPORT_EMPTY = 704020; // VCR: can't close an empty Z-report — benign no-op for us
// UZ statutory VAT rate. Used when neither the product's own vatRate nor the store-wide
// regos_vcr_vat setting is configured. A 0% fallback would send vat_value=0 for goods that
// are registered as VAT-able at soliq → REGOS rejects with 701003 "Ставка НДС не найдена".
const DEFAULT_VAT_PERCENT = 12;
// REGOS sentinel for "Без НДС" sent in a position's vat_value when the store is NOT a VAT payer.
// Confirmed by REGOS support (2026-06-19): non-payers must send -1, NOT 0 (0% is reserved for
// льготники and a non-payer sending vat_value=0 is rejected with 701003 "Ставка НДС запрещена").
// Doubles as the PositionMeta.rate marker for "без НДС" (no numeric rate applies).
const NON_VAT_PAYER_VAT_VALUE = -1;

// Per-position bookkeeping kept alongside the VCR positions so a VAT-rate heal can map a
// position back to its product (to persist the corrected rate) and know its current rate.
interface PositionMeta {
  productId: number;
  rate: number;
}

interface ResolvedConfig {
  enabled: boolean;
  url: string;
  login: string;
  password: string;
  vatPercent: number;
  nonVatPayer: boolean;
  posId: string;
  vcrPrintsReceipt: boolean;
  markingCodeCheck: boolean;
  uzqrEnabled: boolean;
  /** Spread from normalizePollOptions — always present and always sane. */
  intervalMs: number;
  timeoutMs: number;
}

const SETTING_KEYS = {
  enabled: 'regos_vcr_enabled',
  url: 'regos_vcr_url',
  login: 'regos_vcr_login',
  vat: 'regos_vcr_vat',
  nonVatPayer: 'regos_vcr_non_vat_payer',
  posId: 'regos_vcr_pos_id',
  printsReceipt: 'regos_vcr_prints_receipt',
  markingCheck: 'regos_vcr_marking_check',
  uzqrEnabled: 'regos_vcr_uzqr_enabled',
  uzqrPollMs: 'regos_vcr_uzqr_poll_ms',
  uzqrTimeoutMs: 'regos_vcr_uzqr_timeout_ms',
} as const;

class RegosVcrService {
  private worker: NodeJS.Timeout | null = null;
  private running = false;
  private vcrChain: Promise<unknown> = Promise.resolve();

  /**
   * Serialize all VCR interactions — the device is single-threaded and the docs
   * require waiting for each response before sending the next request. Without this,
   * an immediate fiscalization (from sales:create) could overlap a worker tick.
   */
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.vcrChain.then(fn, fn);
    this.vcrChain = run.then(() => undefined, () => undefined);
    return run;
  }

  // ── Config ──────────────────────────────────────────────────────────────────

  private async resolveConfig(): Promise<ResolvedConfig> {
    const prisma = getPrismaClient();
    const appConfig = getAppConfig();
    const rows = await prisma.systemSetting.findMany({
      where: { key: { in: Object.values(SETTING_KEYS) } },
    });
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;

    const password = (await getVcrPassword()) || process.env.VCR_PASSWORD || '';
    return {
      enabled: map[SETTING_KEYS.enabled] === 'true',
      // Default to literal IPv4 loopback, NOT 'localhost'. REGOS:VCR binds 127.0.0.1 only, and
      // Node's fetch (undici, verbatim DNS) tries IPv6 ::1 first for 'localhost' → ECONNREFUSED
      // surfaced as VcrError [0] "fetch failed". 22298 is REGOS's documented port.
      url: map[SETTING_KEYS.url] || process.env.VCR_URL || 'http://127.0.0.1:22298/',
      login: map[SETTING_KEYS.login] || process.env.VCR_LOGIN || 'cassir',
      password,
      vatPercent: parseVatPercent(map[SETTING_KEYS.vat]),
      nonVatPayer: map[SETTING_KEYS.nonVatPayer] === 'true',
      posId: map[SETTING_KEYS.posId] || appConfig.terminalId || 'posgro',
      vcrPrintsReceipt: map[SETTING_KEYS.printsReceipt] === 'true',
      // Default ON — only disabled when explicitly set to 'false'.
      markingCodeCheck: map[SETTING_KEYS.markingCheck] !== 'false',
      // Default OFF, unlike markingCheck above. Stores already taking UzQR through a bank
      // terminal must keep the current behaviour until someone deliberately opts in.
      uzqrEnabled: map[SETTING_KEYS.uzqrEnabled] === 'true',
      ...normalizePollOptions({
        intervalMs: Number(map[SETTING_KEYS.uzqrPollMs]),
        timeoutMs: Number(map[SETTING_KEYS.uzqrTimeoutMs]),
      }),
    };
  }

  async getConfig(): Promise<RegosVcrConfig> {
    const cfg = await this.resolveConfig();
    // Report hasPassword based on whether the stored secret actually DECRYPTS, not just that a
    // row exists. resolveConfig() already decrypted into cfg.password (it falls back to '' when
    // decryption fails), so a stored-but-undecryptable secret correctly surfaces as "not saved"
    // and the UI prompts for re-entry instead of lying with a "сохранён" placeholder.
    const storedButBroken = (await hasVcrPassword()) && !cfg.password;
    if (storedButBroken) {
      log.warn('[fiscal] VCR password is stored but failed to decrypt — prompting for re-entry');
    }
    return {
      enabled: cfg.enabled,
      url: cfg.url,
      login: cfg.login,
      hasPassword: Boolean(cfg.password),
      vatPercent: cfg.vatPercent,
      nonVatPayer: cfg.nonVatPayer,
      posId: cfg.posId,
      vcrPrintsReceipt: cfg.vcrPrintsReceipt,
      markingCodeCheck: cfg.markingCodeCheck,
      uzqrEnabled: cfg.uzqrEnabled,
      uzqrPollMs: cfg.intervalMs,
      uzqrTimeoutMs: cfg.timeoutMs,
    };
  }

  async setConfig(input: RegosVcrConfigInput): Promise<RegosVcrConfig> {
    const prisma = getPrismaClient();
    const writes: Array<[string, string]> = [];
    if (input.enabled !== undefined) writes.push([SETTING_KEYS.enabled, String(input.enabled)]);
    if (input.url !== undefined) writes.push([SETTING_KEYS.url, input.url]);
    if (input.login !== undefined) writes.push([SETTING_KEYS.login, input.login]);
    if (input.vatPercent !== undefined) writes.push([SETTING_KEYS.vat, String(input.vatPercent)]);
    if (input.nonVatPayer !== undefined) writes.push([SETTING_KEYS.nonVatPayer, String(input.nonVatPayer)]);
    if (input.posId !== undefined) writes.push([SETTING_KEYS.posId, input.posId]);
    if (input.vcrPrintsReceipt !== undefined) writes.push([SETTING_KEYS.printsReceipt, String(input.vcrPrintsReceipt)]);
    if (input.markingCodeCheck !== undefined) writes.push([SETTING_KEYS.markingCheck, String(input.markingCodeCheck)]);
    if (input.uzqrEnabled !== undefined) writes.push([SETTING_KEYS.uzqrEnabled, String(input.uzqrEnabled)]);
    if (input.uzqrPollMs !== undefined) writes.push([SETTING_KEYS.uzqrPollMs, String(input.uzqrPollMs)]);
    if (input.uzqrTimeoutMs !== undefined) writes.push([SETTING_KEYS.uzqrTimeoutMs, String(input.uzqrTimeoutMs)]);

    for (const [key, value] of writes) {
      await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
    if (input.password) await setVcrPassword(input.password);
    return this.getConfig();
  }

  async isEnabled(): Promise<boolean> {
    return (await this.resolveConfig()).enabled;
  }

  private buildClient(cfg: ResolvedConfig): RegosVcrClient | null {
    if (!cfg.password) return null;
    return new RegosVcrClient(cfg.url, cfg.login, cfg.password);
  }

  /**
   * Run one VCR call through the same single-threaded queue as fiscalization.
   *
   * Exposed for the UzQR flow, which lives outside this class but must not talk to the device
   * concurrently with a sale or Z-report. Callers pass ONE call at a time — never a whole poll
   * loop — so a buyer taking two minutes cannot block fiscalization for two minutes.
   */
  async runVcr<T>(fn: (client: RegosVcrClient) => Promise<T>): Promise<T> {
    const cfg = await this.resolveConfig();
    const client = this.buildClient(cfg);
    if (!client) throw new Error('Пароль кассира не задан');
    return this.runExclusive(() => fn(client));
  }

  /** Config the UzQR flow needs, without exposing the password to callers. */
  async getUzQrConfig(): Promise<{ enabled: boolean; intervalMs: number; timeoutMs: number }> {
    const cfg = await this.resolveConfig();
    return {
      // Both switches matter: UzQR rides the VCR connection, so it cannot run with fiscalization
      // switched off entirely.
      enabled: cfg.enabled && cfg.uzqrEnabled,
      intervalMs: cfg.intervalMs,
      timeoutMs: cfg.timeoutMs,
    };
  }

  // ── Connection test ───────────────────────────────────────────────────────
  async testConnection(): Promise<FiscalConnectionResult> {
    const cfg = await this.resolveConfig();
    const client = this.buildClient(cfg);
    if (!client) return { ok: false, error: 'Пароль кассира не задан' };
    return this.runExclusive(async () => {
      try {
        const info = await client.initialize();
        const overflow = await client.getOverflowInfo();
        return {
          ok: true,
          terminalId: info.TerminalID,
          appletVersion: info.AppletVersion,
          availableZReports: overflow.AvaialableZReportCount,
          availableUnsentReceipts: overflow.AvaialableUnsendReceiptCount,
        };
      } catch (e) {
        return { ok: false, error: this.errText(e) };
      }
    });
  }

  // ── Shift (Z-report) mapping ────────────────────────────────────────────────
  private async ensureZReportOpen(client: RegosVcrClient, smenaId: string | null): Promise<void> {
    const info = await client.zGetInfo(false);
    const isOpen = Boolean(info.OpenTime?.trim()) && !info.CloseTime?.trim();
    if (!isOpen) {
      const z = await client.zOpen();
      if (smenaId) {
        await getPrismaClient().smena.update({
          where: { id: smenaId },
          data: { regosZReportId: z.id },
        }).catch(() => {});
      }
    }
  }

  /** Ensure a VCR Z-report is open for a new shift (called from smena:open). Best-effort. */
  async openShift(smenaId: string): Promise<void> {
    const cfg = await this.resolveConfig();
    if (!cfg.enabled) return;
    const client = this.buildClient(cfg);
    if (!client) return;
    await this.runExclusive(async () => {
      try {
        await this.ensureZReportOpen(client, smenaId);
      } catch (e) {
        console.error('[fiscal] openShift failed:', this.errText(e));
      }
    });
  }

  /** Close the VCR Z-report (called when a Smena closes). Best-effort. */
  async closeZReport(): Promise<void> {
    const cfg = await this.resolveConfig();
    if (!cfg.enabled) return;
    const client = this.buildClient(cfg);
    if (!client) return;
    await this.runExclusive(async () => {
      try {
        await client.zClose();
      } catch (e) {
        // An empty Z-report (no receipts) can't be closed — that's expected, not an error.
        if (e instanceof VcrError && e.code === ERR_ZREPORT_EMPTY) return;
        console.error('[fiscal] ZReport.Close failed:', this.errText(e));
      }
    });
  }

  // ── Z-report status / manual control (for the Smena page) ───────────────────

  /** Current fiscal Z-report info for display (ZReport.GetInfo, no print). */
  async getZReportInfo(): Promise<FiscalZReportStatus> {
    const cfg = await this.resolveConfig();
    if (!cfg.enabled) return { enabled: false, open: false };
    const client = this.buildClient(cfg);
    if (!client) return { enabled: true, open: false, error: 'Пароль кассира не задан' };
    return this.runExclusive(async () => {
      try {
        const z = await client.zGetInfo(false);
        const open = Boolean(z.OpenTime?.trim()) && !z.CloseTime?.trim();
        return {
          enabled: true,
          open,
          info: {
            terminalId: z.TerminalID,
            number: z.Number,
            openTime: z.OpenTime,
            closeTime: z.CloseTime,
            totalSaleCount: z.TotalSaleCount,
            totalSaleCash: z.TotalSaleCash / 100,
            totalSaleCard: z.TotalSaleCard / 100,
            totalSaleVat: z.TotalSaleVat / 100,
            totalRefundCount: z.TotalRefundCount,
            totalRefundCash: z.TotalRefundCash / 100,
            totalRefundCard: z.TotalRefundCard / 100,
          },
        };
      } catch (e) {
        return { enabled: true, open: false, error: this.errText(e) };
      }
    });
  }

  /** Manually open the fiscal Z-report (resync when shift is open but Z-report isn't). */
  async openZReportManual(): Promise<{ ok: boolean; error?: string }> {
    const cfg = await this.resolveConfig();
    if (!cfg.enabled) return { ok: false, error: 'Фискализация выключена' };
    const client = this.buildClient(cfg);
    if (!client) return { ok: false, error: 'Пароль кассира не задан' };
    const smena = await getPrismaClient().smena.findFirst({
      where: { status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
    });
    return this.runExclusive(async () => {
      try {
        await this.ensureZReportOpen(client, smena?.id ?? null);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: this.errText(e) };
      }
    });
  }

  /** Manually close the fiscal Z-report (returns a result for UI feedback). */
  async closeZReportManual(): Promise<{ ok: boolean; error?: string }> {
    const cfg = await this.resolveConfig();
    if (!cfg.enabled) return { ok: false, error: 'Фискализация выключена' };
    const client = this.buildClient(cfg);
    if (!client) return { ok: false, error: 'Пароль кассира не задан' };
    return this.runExclusive(async () => {
      try {
        await client.zClose();
        return { ok: true };
      } catch (e) {
        // Empty Z-report → nothing to close; treat as success so the UI isn't alarmed.
        if (e instanceof VcrError && e.code === ERR_ZREPORT_EMPTY) return { ok: true };
        return { ok: false, error: this.errText(e) };
      }
    });
  }

  // ── Position / payment builders ─────────────────────────────────────────────
  private async buildPositions(
    sale: { discountAmount: unknown; regosLabels: string | null; items: Array<Record<string, unknown>> },
    cfg: ResolvedConfig,
  ): Promise<{ positions: VcrPosition[]; meta: PositionMeta[] }> {
    const prisma = getPrismaClient();
    const labels: FiscalLabel[] = sale.regosLabels ? safeParseLabels(sale.regosLabels) : [];
    const labelByBarcode = new Map(labels.map((l) => [l.barcode, l.label]));

    const orderDiscount = Number(sale.discountAmount) || 0;
    const totalSubtotal = sale.items.reduce((s, it) => s + Number(it.subtotal), 0) || 1;

    const positions: VcrPosition[] = [];
    const meta: PositionMeta[] = [];
    for (const item of sale.items) {
      const product = await prisma.product.findUnique({
        where: { id: Number(item.productId) },
        include: { category: true },
      });
      const subtotal = Number(item.subtotal);
      const amount = Math.round(subtotal * 100);
      // Non-VAT-payer store: send "Без НДС" (vat_value=-1) for every line and ignore any
      // per-product/global rate. -1 is the REGOS sentinel for "не плательщик НДС" — DISTINCT
      // from a 0% rate (vat_value=0, льготники only, rejected for non-payers). `rate` is set to
      // the same sentinel purely so the heal short-circuits and the failure log reads "без НДС".
      // Otherwise: VAT must match the rate registered for the product's MXIK — a mixed catalog
      // (0% staples vs 12% goods) can't use one global rate. Prefer the product's own vatRate;
      // fall back to the store-wide default only when it's unset.
      const rate = cfg.nonVatPayer ? NON_VAT_PAYER_VAT_VALUE : (product?.vatRate ?? cfg.vatPercent);
      // Round VAT *up*, not to nearest. REGOS re-derives the rate from the position as
      // vat_value*100/(amount-vat_value) and TRUNCATES it. Math.round here yields a VAT whose
      // implied rate lands just under the target (e.g. 12% → 11.9946%), which truncates to 11%
      // — an unregistered rate → 701003 "Ставка НДС не найдена". Ceil keeps the implied rate in
      // [rate, rate+ε) so it truncates back to exactly `rate`; cost is ≤1 tiyin extra VAT.
      const vat = cfg.nonVatPayer
        ? NON_VAT_PAYER_VAT_VALUE
        : rate > 0
          ? Math.ceil((amount * rate) / (100 + rate))
          : 0;
      const discount =
        orderDiscount > 0 ? Math.round(((orderDiscount * subtotal) / totalSubtotal) * 100) : 0;

      const pos: VcrPosition = {
        name: String(item.productName),
        barcode: String(item.barcode),
        icps: product?.mxik ?? '',
        amount,
        // REGOS is told the PHYSICAL piece count, not the number of boxes. Its implied unit
        // price is amount/quantity, and package_code registers the product in its SMALLEST
        // packaging unit (pickSingleUnitPackage in shared/utils/mxik-packages), i.e. one piece.
        // Sending 1 for a box would make the implied unit price the box price and disagree with
        // the registered package. amount stays the true line total, so 2 boxes of 5 @ 45 000
        // report quantity 10 000 (10 pcs) / amount 9 000 000 → 9 000 per piece.
        quantity: Math.round(
          toPieces(Number(item.quantity), Number(item.piecesPerUnit ?? 1)) * 1000,
        ),
        vat_value: vat,
        discount,
        unit_name: product?.unit ?? undefined,
        group_name: product?.category?.nameRu ?? undefined,
        owner_type: 'BuyingAndSelling',
      };
      if (product?.packageCode) pos.package_code = product.packageCode;
      const label = labelByBarcode.get(String(item.barcode));
      if (label) pos.label = label;
      positions.push(pos);
      meta.push({ productId: Number(item.productId), rate });
    }
    return { positions, meta };
  }

  /**
   * Self-heal a VAT-rate rejection. REGOS resolves each position's VAT rate from its MXIK in the
   * soliq registry and rejects a wrong rate; our stored product.vatRate (or the global default)
   * can disagree — e.g. a VAT-exempt staple left NULL falls back to 12%. Rather than orphan the
   * sale as FAILED, re-probe the real device per position (Receipt.ValidateSale is side-effect
   * free) to find the rate it actually accepts, correct vat_value in place, and persist the
   * discovered rate back onto the product so it syncs to every terminal and never fails again.
   *
   * Reuses the real positions (so marking labels / package codes are present) and only varies
   * vat_value. Returns true if any position's rate was corrected (caller should retry the sale).
   */
  private async healVatRates(
    client: RegosVcrClient,
    positions: VcrPosition[],
    meta: PositionMeta[],
  ): Promise<boolean> {
    const prisma = getPrismaClient();
    let changed = false;
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const currentRate = meta[i].rate;
      // Try the line's current rate first (it may be a different line that's wrong), then the
      // statutory alternatives. dedup keeps the probe count minimal.
      const candidates = [...new Set([currentRate, 0, 12, 6])];
      let accepted: number | null = null;
      for (const rate of candidates) {
        const vat = rate > 0 ? Math.ceil((pos.amount * rate) / (100 + rate)) : 0;
        try {
          await client.validateSale([{ ...pos, vat_value: vat }], [{ type: 1, value: pos.amount }], true);
          accepted = rate;
          pos.vat_value = vat; // mutate the real position used by the retried sale
          break;
        } catch (e) {
          if (e instanceof VcrError && e.code === 0) throw e; // device unreachable — abort healing
          if (e instanceof VcrError && isVatRateError(e)) continue; // wrong rate — try next candidate
          break; // a non-VAT line fault (marking/MXIK) — can't heal this line, leave it
        }
      }
      if (accepted !== null && accepted !== currentRate) {
        changed = true;
        meta[i].rate = accepted;
        log.info(`[fiscal] VAT heal: product ${meta[i].productId} ${currentRate}% → ${accepted}%`);
        await prisma.product
          .update({ where: { id: meta[i].productId }, data: { vatRate: accepted } })
          .catch(() => {}); // bumps updatedAt → syncs the corrected rate up and back down
      }
    }
    return changed;
  }

  private buildPayments(sale: {
    paymentMethod: string;
    finalAmount: unknown;
    regosPaymentId?: string | null;
  }): VcrPayment[] {
    const value = Math.round(Number(sale.finalAmount) * 100);
    // paymentMethod may be 'cash'/'card'/'uzqr' (POS quick-pay) or upper-case elsewhere.
    if (isCashTender(sale.paymentMethod)) return [{ type: 1, value }];

    // A Payment.Create-backed tender (UzQR) is booked by REFERENCE: VCR already holds the
    // amount against that payment id, so the receipt links to it instead of restating a sum.
    // `value` is deliberately omitted — the Receipt.Sale example for a Payment.Create-backed
    // payment sends payment_id alone, and sending both risks a mismatch rejection.
    //
    // Only ONE such payment is allowed per receipt, and it may not be reused across receipts,
    // which is why the UzQR flow fiscalizes immediately rather than deferring.
    if (sale.regosPaymentId) return [{ type: 2, payment_id: sale.regosPaymentId }];

    // Plain cashless: a bank terminal the POS does not drive (card, or UzQR with the
    // integration switched off). REGOS treats it as a card payment.
    return [{ type: 2, value, card_type: 2 }];
  }

  /**
   * Reconstruct everything about a receipt for the Receipt Details modal — the stored
   * fiscal metadata + the EXACT Receipt.Sale body sent to REGOS:VCR. Read-only: it reuses
   * buildPositions/buildPayments (no VCR calls, no writes), so it's the ground truth for
   * "what is sent to the fiscal module", including per-line MXIK, package_code, VAT and the
   * marking DataMatrix labels. Returns null if the sale doesn't exist.
   */
  async previewSalePayload(saleId: string): Promise<FiscalSalePreview | null> {
    const prisma = getPrismaClient();
    const sale = await prisma.sale.findUnique({ where: { id: saleId }, include: { items: true } });
    if (!sale) return null;

    const cfg = await this.resolveConfig();
    const { positions } = await this.buildPositions(sale as never, cfg);
    const payments = this.buildPayments(sale as never);
    const labels: FiscalLabel[] = sale.regosLabels ? safeParseLabels(sale.regosLabels) : [];

    return {
      saleId: sale.id,
      receiptNumber: sale.receiptNumber,
      createdAt: sale.createdAt.toISOString(),
      cashierName: sale.cashierName,
      terminalId: sale.terminalId,
      paymentMethod: sale.paymentMethod,
      totalAmount: Number(sale.totalAmount),
      discountAmount: Number(sale.discountAmount),
      finalAmount: Number(sale.finalAmount),
      fiscalStatus: sale.fiscalStatus ?? null,
      fiscalError: sale.fiscalError ?? null,
      fiscalAttempts: sale.fiscalAttempts ?? null,
      regosReceiptNo: sale.regosReceiptNo ?? null,
      regosReceiptId: sale.regosReceiptId ?? null,
      regosFiscalSign: sale.regosFiscalSign ?? null,
      regosQrCodeUrl: sale.regosQrCodeUrl ?? null,
      regosTerminalId: sale.regosTerminalId ?? null,
      regosFiscalAt: sale.regosFiscalAt ? sale.regosFiscalAt.toISOString() : null,
      refunded: sale.refunded ?? false,
      labels,
      config: {
        enabled: cfg.enabled,
        url: cfg.url,
        login: cfg.login,
        posId: cfg.posId,
        nonVatPayer: cfg.nonVatPayer,
        vatPercent: cfg.vatPercent,
      },
      request: {
        method: 'Receipt.Sale',
        code: sale.id,
        pos_id: cfg.posId,
        session_code: sale.smenaId ?? null,
        cashier_name: sale.cashierName,
        positions: positions as unknown as FiscalPreviewPosition[],
        payments: payments as unknown as FiscalPreviewPayment[],
      },
    };
  }

  // ── Fiscalize one sale ───────────────────────────────────────────────────────
  async fiscalizeSale(saleId: string): Promise<void> {
    return this.runExclusive(() => this.fiscalizeSaleImpl(saleId));
  }

  private async fiscalizeSaleImpl(saleId: string): Promise<void> {
    const cfg = await this.resolveConfig();
    if (!cfg.enabled) return;
    const prisma = getPrismaClient();
    const client = this.buildClient(cfg);
    if (!client) {
      await prisma.sale.update({
        where: { id: saleId },
        data: { fiscalStatus: 'FAILED', fiscalError: 'Пароль кассира не задан' },
      }).catch(() => {});
      return;
    }

    const sale = await prisma.sale.findUnique({ where: { id: saleId }, include: { items: true } });
    if (!sale || sale.fiscalStatus === 'FISCALIZED') return;

    // Hoisted so the catch block can log the VAT rates / amounts actually sent to the VCR.
    let positions: VcrPosition[] = [];
    let meta: PositionMeta[] = [];
    try {
      await this.ensureZReportOpen(client, sale.smenaId);
      ({ positions, meta } = await this.buildPositions(sale as never, cfg));
      const payments = this.buildPayments(sale as never);
      if (FISCAL_DEBUG) {
        console.log('[fiscal] positions:', JSON.stringify(positions));
        console.log('[fiscal] payments:', JSON.stringify(payments));
      }
      let result: VcrReceiptResult | null = null;
      // One heal-and-retry: if REGOS rejects the VAT rate, re-probe the device per position to
      // learn the rate it accepts, correct it (and persist back to the product), then retry once.
      for (let healed = false; result === null; ) {
        try {
          await client.validateSale(positions, payments, false);
          result = await client.sale({
            positions,
            payments,
            code: sale.id, // idempotency key
            session_code: sale.smenaId ?? undefined,
            cashier_name: sale.cashierName,
            pos_id: cfg.posId,
          });
        } catch (e) {
          // The VAT-rate heal probes numeric rates [0,12,6]; it's meaningless (and wrong) for a
          // non-VAT-payer store, whose only valid value is the "Без НДС" sentinel — skip it.
          if (!healed && !cfg.nonVatPayer && e instanceof VcrError && isVatRateError(e)) {
            healed = true;
            if (await this.healVatRates(client, positions, meta)) {
              log.info(`[fiscal] VAT rates healed for ${sale.receiptNumber} — retrying`);
              continue;
            }
          }
          throw e;
        }
      }
      console.log(`[fiscal] FISCALIZED ${sale.receiptNumber} → ReceiptNo=${result.ReceiptNo}`);
      await prisma.sale.update({
        where: { id: saleId },
        data: {
          fiscalStatus: 'FISCALIZED',
          regosReceiptId: result.Id,
          regosFiscalSign: result.FiscalSign,
          regosQrCodeUrl: result.QRCodeURL,
          regosTerminalId: result.TerminalID,
          regosReceiptNo: result.ReceiptNo,
          regosFiscalAt: new Date(),
          fiscalError: null,
        },
      });
    } catch (e) {
      // Use the electron-log instance (not raw console) so these lines land in the upload buffer
      // → terminal_logs → super-admin Logs dashboard. Main-process console is NOT captured.
      log.error(`[fiscal] ✗ fiscalize ${saleId} failed: ${this.errText(e)}`);
      // Log the raw REGOS code + description too — describeVcrError() collapses several distinct
      // VAT/MXIK faults into one staff message, which hides which one actually fired when debugging.
      if (e instanceof VcrError) log.error(`[fiscal] raw VCR error [${e.code}] ${e.method}: ${e.description}`);
      const unreachable = e instanceof VcrError && e.code === 0;

      // Recovery: a business-level failure may mean Receipt.Sale actually registered on
      // the VCR but the response was lost, or this is a retry hitting the uniqueness guard
      // (we send sale.id as `code`). Either way the receipt exists fiscally — look it up by
      // our code and adopt it rather than orphaning a fiscalized sale as FAILED. Skipped for
      // network errors (nothing was sent) and validation errors return null here harmlessly.
      if (!unreachable) {
        const recovered = await this.tryRecoverByCode(client, sale.id);
        if (recovered) {
          console.log(`[fiscal] recovered ${sale.receiptNumber} by code → ReceiptNo=${recovered.ReceiptNo}`);
          await prisma.sale.update({
            where: { id: saleId },
            data: {
              fiscalStatus: 'FISCALIZED',
              regosReceiptId: recovered.Id,
              regosFiscalSign: recovered.FiscalSign,
              regosQrCodeUrl: recovered.QRCodeURL,
              regosTerminalId: recovered.TerminalID,
              regosReceiptNo: recovered.ReceiptNo,
              regosFiscalAt: new Date(),
              fiscalError: null,
            },
          }).catch(() => {});
          return; // recovered — do not propagate the error
        }
      }

      await prisma.sale.update({
        where: { id: saleId },
        data: unreachable
          ? { fiscalStatus: 'PENDING', fiscalError: this.errText(e) }
          : { fiscalStatus: 'FAILED', fiscalAttempts: { increment: 1 }, fiscalError: this.errText(e) },
      }).catch(() => {});
      throw e;
    }
  }

  /**
   * Look up a receipt on the VCR by our idempotency `code` (= sale.id). Returns the
   * fiscal result only if a fiscalized receipt with a FiscalSign is found, else null.
   * Never throws — a failed lookup (network, not found) just means "no recovery".
   */
  private async tryRecoverByCode(
    client: RegosVcrClient,
    code: string,
  ): Promise<(VcrReceiptResult & { Code: string }) | null> {
    try {
      const existing = await client.getReceiptInfo({ Code: code });
      return existing?.FiscalSign ? existing : null;
    } catch {
      return null;
    }
  }

  /** Manual admin retry — clears the attempt cap for one sale. Returns a result (never throws). */
  async retrySale(saleId: string): Promise<{ ok: boolean; error?: string }> {
    await getPrismaClient().sale.update({
      where: { id: saleId },
      data: { fiscalStatus: 'PENDING', fiscalAttempts: 0, fiscalError: null },
    });
    try {
      await this.fiscalizeSale(saleId);
      return { ok: true };
    } catch (e) {
      if (e instanceof VcrError) return { ok: false, error: describeVcrError(e.code, e.description) };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Print a fiscal duplicate of a fiscalized sale's receipt. */
  async printDuplicate(saleId: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = await this.resolveConfig();
    const client = this.buildClient(cfg);
    const sale = await getPrismaClient().sale.findUnique({ where: { id: saleId } });
    if (!sale?.regosReceiptId) return { ok: false, error: 'Чек не фискализирован' };
    if (!client) return { ok: false, error: 'Виртуальная касса не настроена' };
    return this.runExclusive(async () => {
      try {
        await client.duplicate(sale.regosReceiptId!);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: this.errText(e) };
      }
    });
  }

  /** Full refund of a fiscalized sale via its stored QR code. */
  async refundSale(saleId: string): Promise<{ ok: boolean; fiscalSign?: string; error?: string }> {
    const cfg = await this.resolveConfig();
    const client = this.buildClient(cfg);
    const sale = await getPrismaClient().sale.findUnique({ where: { id: saleId } });
    if (!sale?.regosQrCodeUrl) return { ok: false, error: 'Чек не фискализирован' };
    if (!client) return { ok: false, error: 'Виртуальная касса не настроена' };
    return this.runExclusive(async () => {
      try {
        const result = await client.fullRefund(sale.regosQrCodeUrl!);
        await getPrismaClient().sale.update({ where: { id: saleId }, data: { refunded: true } });
        return { ok: true, fiscalSign: result.FiscalSign };
      } catch (e) {
        return { ok: false, error: this.errText(e) };
      }
    });
  }

  // ── Background worker ─────────────────────────────────────────────────────────
  async processPending(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const cfg = await this.resolveConfig();
      if (!cfg.enabled) return;
      const prisma = getPrismaClient();
      const pending = await prisma.sale.findMany({
        where: { fiscalStatus: { in: ['PENDING', 'FAILED'] }, fiscalAttempts: { lt: MAX_ATTEMPTS } },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      for (const s of pending) {
        try {
          await this.fiscalizeSale(s.id);
        } catch (e) {
          // VCR unreachable → stop this cycle (no point hammering); retry next tick.
          if (e instanceof VcrError && e.code === 0) break;
          // business error → already recorded; continue to next sale
        }
      }
    } finally {
      this.running = false;
    }
  }

  async getQueueStatus(): Promise<FiscalQueueStatus> {
    const prisma = getPrismaClient();
    const enabled = await this.isEnabled();
    const [pending, failed, fiscalized] = await Promise.all([
      prisma.sale.count({ where: { fiscalStatus: 'PENDING' } }),
      prisma.sale.count({ where: { fiscalStatus: 'FAILED' } }),
      prisma.sale.count({ where: { fiscalStatus: 'FISCALIZED' } }),
    ]);
    return { enabled, pending, failed, fiscalized };
  }

  /**
   * One-shot admin action behind the "Fiscalise all old receipts" button — replaces the removed
   * background retry worker for clearing a backlog:
   *   • Receipts WITH a group-022 marked product → repair any marking labels that were captured
   *     under a Cyrillic keyboard layout (so the VCR accepts them), reset to PENDING, fiscalise.
   *   • Receipts WITHOUT any 022 product → mark DISABLED so they leave the pending/failed queue;
   *     an unmarked sale predating the VCR does not need retroactive fiscalisation.
   * Stops early (leaving the rest PENDING) if the VCR turns out to be unreachable.
   */
  async fiscalizeOldReceipts(
    onProgress?: (p: FiscalBulkProgress) => void,
  ): Promise<FiscalBulkResult> {
    const cfg = await this.resolveConfig();
    if (!cfg.enabled) {
      return { enabled: false, fiscalized: 0, failed: 0, repaired: 0, disabled: 0, outOfCirculation: 0 };
    }
    const prisma = getPrismaClient();

    // Every not-yet-fiscalised receipt, with just enough to classify it as marked goods and (for
    // marked ones) verify its marking codes. Marking is a per-product property (the product's own
    // MXIK group 022), NOT the category's group list — a category's list can span many groups.
    const sales = await prisma.sale.findMany({
      where: { fiscalStatus: { not: 'FISCALIZED' } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        receiptNumber: true,
        regosLabels: true,
        items: { select: { product: { select: { mxik: true, isMarked: true } } } },
      },
    });

    type SaleRow = (typeof sales)[number];
    // getPrismaClient() is dynamically required (untyped), so `sales` is `any`; annotate the
    // marked-item shape explicitly so this classification is type-checked, not implicit-any.
    type MarkedItem = { product: { mxik: string | null; isMarked: boolean | null } | null };
    const isMarked = (s: SaleRow): boolean =>
      (s.items as MarkedItem[]).some((it) => it.product != null && productRequiresMarking(it.product));

    const marked = sales.filter(isMarked);
    const unmarkedIds = sales.filter((s: SaleRow) => !isMarked(s)).map((s: SaleRow) => s.id);

    // Unmarked → DISABLED in one batch so they drop out of the queue badge.
    let disabled = 0;
    if (unmarkedIds.length) {
      const r = await prisma.sale.updateMany({
        where: { id: { in: unmarkedIds }, fiscalStatus: { not: 'FISCALIZED' } },
        data: { fiscalStatus: 'DISABLED', fiscalError: null },
      });
      disabled = r.count;
    }

    // Marked → for each: verify circulation (asl-belgisi) first; disable if any code is out of
    // circulation, else repair labels, reset, and fiscalise one at a time (the VCR is
    // single-threaded; each fiscalizeSale already serialises through runExclusive).
    let fiscalized = 0;
    let failed = 0;
    let repaired = 0;
    let outOfCirculation = 0;
    let unreachable = false;
    const total = marked.length;
    let processed = 0;

    const emit = (extra: Partial<FiscalBulkProgress>): void => {
      onProgress?.({
        phase: 'checking', processed, total, fiscalized, failed, disabled, outOfCirculation,
        ...extra,
      });
    };
    emit({ phase: 'checking', processed: 0 });

    for (const sale of marked) {
      const id = sale.id;
      const receipt = sale.receiptNumber;

      // 1) Circulation gate — disable the receipt up front if a marking code is dead, so the VCR
      // is never asked to fiscalise it (it would reject with [704030]). Offline-first: an
      // unreachable registry leaves the receipt to the normal fiscalisation path below.
      emit({ phase: 'checking', currentReceipt: receipt });
      const labels = sale.regosLabels ? safeParseLabels(sale.regosLabels) : [];
      let deadStatus: string | null = null;
      for (const l of labels) {
        if (!l?.label) continue;
        const res = await isCodeOutOfCirculation(l.label);
        if (res.reachable && res.outOfCirculation) {
          deadStatus = res.status ?? 'OUT';
          break;
        }
      }

      if (deadStatus) {
        await prisma.sale
          .update({
            where: { id },
            data: { fiscalStatus: 'DISABLED', fiscalError: `out_of_circulation:${deadStatus}` },
          })
          .catch(() => {});
        outOfCirculation++;
        processed++;
        emit({ phase: 'disabled', processed, currentReceipt: receipt, lastDisabled: { receipt, status: deadStatus } });
        continue;
      }

      // 2) Normal path — repair labels, reset, fiscalise.
      emit({ phase: 'fiscalizing', currentReceipt: receipt });
      repaired += await this.repairSaleLabels(id);
      await prisma.sale
        .update({ where: { id }, data: { fiscalStatus: 'PENDING', fiscalAttempts: 0, fiscalError: null } })
        .catch(() => {});
      try {
        await this.fiscalizeSale(id);
        fiscalized++;
      } catch (e) {
        failed++;
        // VCR unreachable → stop hammering; the remaining receipts stay PENDING for a later run.
        if (e instanceof VcrError && e.code === 0) {
          unreachable = true;
          processed++;
          break;
        }
      }
      processed++;
      emit({ phase: 'fiscalizing', processed, currentReceipt: receipt });
    }

    onProgress?.({
      phase: 'done', processed, total, fiscalized, failed, disabled, outOfCirculation,
    });

    log.info(
      `[fiscal] bulk fiscalise: ${fiscalized} fiscalised, ${failed} failed, ${repaired} labels repaired, ${disabled} disabled, ${outOfCirculation} out-of-circulation${unreachable ? ' (VCR unreachable — stopped early)' : ''}`,
    );
    return { enabled: true, fiscalized, failed, repaired, disabled, outOfCirculation, unreachable };
  }

  /**
   * Repair a sale's stored marking labels (sale.regosLabels) that were captured while a Cyrillic
   * keyboard layout was active, mapping each corrupted label back to the ASCII the scanner meant.
   * Returns the number of labels actually changed; a no-op (0) when there are none or none are
   * corrupted. See keyboard-layout.ts for why the corruption is deterministic and reversible.
   */
  private async repairSaleLabels(saleId: string): Promise<number> {
    const prisma = getPrismaClient();
    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      select: { regosLabels: true },
    });
    if (!sale?.regosLabels) return 0;
    let labels: FiscalLabel[];
    try {
      const parsed = JSON.parse(sale.regosLabels);
      if (!Array.isArray(parsed)) return 0;
      labels = parsed;
    } catch {
      return 0;
    }
    let changed = 0;
    const fixed = labels.map((l) => {
      if (l?.label && isLayoutCorrupted(l.label)) {
        changed++;
        return { ...l, label: repairCyrillicLayout(l.label) };
      }
      return l;
    });
    if (changed > 0) {
      await prisma.sale
        .update({ where: { id: saleId }, data: { regosLabels: JSON.stringify(fixed) } })
        .catch(() => {});
    }
    return changed;
  }

  start(): void {
    // One-time startup diagnostic: surface what config the service actually resolved after a
    // reboot, so a "settings keep disappearing" report can be confirmed (or ruled out) from the
    // log instead of guesswork — including whether the stored VCR password decrypted.
    this.logStartupConfig().catch(() => {});
    // NOTE: the periodic background retry worker was removed by request. Fiscalization now happens
    // (a) immediately when a sale is created, (b) as a flush on shift close (smena:close →
    // processPending), and (c) on demand via the "Fiscalise all old receipts" admin button
    // (fiscalizeOldReceipts). A silently-looping retry that hammers the VCR every 30s is gone.
  }

  /**
   * Strip the password out of a connection string before it reaches a log.
   *
   * This diagnostic is uploaded: `flushLogs()` ships it to `POST /logs/upload`, where it lands in
   * the VPS `terminal_logs` table and the super-admin Logs page. A terminal's own SQLite path is
   * `file:...` and carries no secret, but the value must be sanitised on the way out regardless —
   * this line has already leaked a PostgreSQL password once.
   */
  private redactConnection(url: string | undefined): string {
    if (!url) return '(unset)';
    // Everything between "scheme://" and the LAST "@" of the authority goes, username included.
    // Greedy on purpose: a password containing an unescaped "@" would otherwise survive in part,
    // and over-redacting a diagnostic costs nothing while under-redacting a secret costs a lot.
    // A `file:` URL has no authority and no "@", so a terminal's own path is left readable.
    return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1***@');
  }

  private async logStartupConfig(): Promise<void> {
    try {
      const cfg = await this.resolveConfig();
      const passwordRowExists = await hasVcrPassword();
      log.info('[fiscal] resolved config at startup', {
        db: this.redactConnection(process.env.DATABASE_URL),
        enabled: cfg.enabled,
        url: cfg.url,
        login: cfg.login,
        posId: cfg.posId,
        passwordRowExists,
        passwordDecrypted: Boolean(cfg.password),
      });
      if (passwordRowExists && !cfg.password) {
        log.error('[fiscal] VCR password row present but did NOT decrypt — re-entry required');
      }
    } catch (e) {
      log.error('[fiscal] failed to resolve config at startup:', e instanceof Error ? e.message : e);
    }
  }

  stop(): void {
    if (this.worker) {
      clearInterval(this.worker);
      this.worker = null;
    }
  }

  private errText(e: unknown): string {
    if (e instanceof VcrError) return `[${e.code}] ${describeVcrError(e.code, e.description)}`;
    return e instanceof Error ? e.message : String(e);
  }
}

export const regosVcrService = new RegosVcrService();

/**
 * Resolve the store-wide VAT percent from its stored setting. An unset/blank/invalid value
 * falls back to the UZ statutory rate (12%) — never silently to 0%, which would fiscalize
 * VAT-able goods with vat_value=0 and trip REGOS 701003. An explicit "0" is honoured (a store
 * that genuinely sells only exempt goods can still set 0%).
 */
/**
 * True when a VCR rejection is about the VAT rate not matching the product's MXIK registration.
 * REGOS surfaces these as 701003 with a "Ставка НДС…" description; gate on the text so a generic
 * 701003 (e.g. an MXIK fault) doesn't trigger a pointless heal pass.
 */
function isVatRateError(e: VcrError): boolean {
  return /ставка\s*ндс/i.test(e.description || '');
}

function parseVatPercent(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') return DEFAULT_VAT_PERCENT;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_VAT_PERCENT;
}

function safeParseLabels(json: string): FiscalLabel[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
