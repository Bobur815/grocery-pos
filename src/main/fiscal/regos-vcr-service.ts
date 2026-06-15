// REGOS:VCR fiscalization service (main process).
// Owns config, the sale → fiscal-receipt pipeline, Z-report (shift) mapping, and a
// background retry worker. Failure mode: "allow + fiscalize later" — sales complete
// locally with fiscal_status=PENDING and are fiscalized here (immediately or on retry).

import { getPrismaClient } from '../database/sqlite-client';
import { getAppConfig } from '../config/app-config';
import { getVcrPassword, hasVcrPassword, setVcrPassword } from './secret-store';
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
  FiscalLabel,
  FiscalZReportStatus,
} from '../../shared/types/fiscal.types';

const MAX_ATTEMPTS = 5; // cap retries for hard (business) failures
const WORKER_INTERVAL_MS = 30_000;
const FISCAL_DEBUG = process.env.FISCAL_DEBUG === 'true'; // verbose position/payment logs
const ERR_ZREPORT_EMPTY = 704020; // VCR: can't close an empty Z-report — benign no-op for us

interface ResolvedConfig {
  enabled: boolean;
  url: string;
  login: string;
  password: string;
  vatPercent: number;
  posId: string;
  vcrPrintsReceipt: boolean;
  markingCodeCheck: boolean;
}

const SETTING_KEYS = {
  enabled: 'regos_vcr_enabled',
  url: 'regos_vcr_url',
  login: 'regos_vcr_login',
  vat: 'regos_vcr_vat',
  posId: 'regos_vcr_pos_id',
  printsReceipt: 'regos_vcr_prints_receipt',
  markingCheck: 'regos_vcr_marking_check',
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
      url: map[SETTING_KEYS.url] || process.env.VCR_URL || 'http://localhost:8080',
      login: map[SETTING_KEYS.login] || process.env.VCR_LOGIN || 'cassir',
      password,
      vatPercent: Number(map[SETTING_KEYS.vat] ?? '0') || 0,
      posId: map[SETTING_KEYS.posId] || appConfig.terminalId || 'posgro',
      vcrPrintsReceipt: map[SETTING_KEYS.printsReceipt] === 'true',
      // Default ON — only disabled when explicitly set to 'false'.
      markingCodeCheck: map[SETTING_KEYS.markingCheck] !== 'false',
    };
  }

  async getConfig(): Promise<RegosVcrConfig> {
    const cfg = await this.resolveConfig();
    return {
      enabled: cfg.enabled,
      url: cfg.url,
      login: cfg.login,
      hasPassword: (await hasVcrPassword()) || Boolean(process.env.VCR_PASSWORD),
      vatPercent: cfg.vatPercent,
      posId: cfg.posId,
      vcrPrintsReceipt: cfg.vcrPrintsReceipt,
      markingCodeCheck: cfg.markingCodeCheck,
    };
  }

  async setConfig(input: RegosVcrConfigInput): Promise<RegosVcrConfig> {
    const prisma = getPrismaClient();
    const writes: Array<[string, string]> = [];
    if (input.enabled !== undefined) writes.push([SETTING_KEYS.enabled, String(input.enabled)]);
    if (input.url !== undefined) writes.push([SETTING_KEYS.url, input.url]);
    if (input.login !== undefined) writes.push([SETTING_KEYS.login, input.login]);
    if (input.vatPercent !== undefined) writes.push([SETTING_KEYS.vat, String(input.vatPercent)]);
    if (input.posId !== undefined) writes.push([SETTING_KEYS.posId, input.posId]);
    if (input.vcrPrintsReceipt !== undefined) writes.push([SETTING_KEYS.printsReceipt, String(input.vcrPrintsReceipt)]);
    if (input.markingCodeCheck !== undefined) writes.push([SETTING_KEYS.markingCheck, String(input.markingCodeCheck)]);

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
  ): Promise<VcrPosition[]> {
    const prisma = getPrismaClient();
    const labels: FiscalLabel[] = sale.regosLabels ? safeParseLabels(sale.regosLabels) : [];
    const labelByBarcode = new Map(labels.map((l) => [l.barcode, l.label]));

    const orderDiscount = Number(sale.discountAmount) || 0;
    const totalSubtotal = sale.items.reduce((s, it) => s + Number(it.subtotal), 0) || 1;

    const positions: VcrPosition[] = [];
    for (const item of sale.items) {
      const product = await prisma.product.findUnique({
        where: { id: Number(item.productId) },
        include: { category: true },
      });
      const subtotal = Number(item.subtotal);
      const amount = Math.round(subtotal * 100);
      // VAT must match the rate registered for the product's MXIK — a mixed catalog
      // (0% staples vs 12% goods) can't use one global rate. Prefer the product's own
      // vatRate; fall back to the store-wide default only when it's unset.
      const rate = product?.vatRate ?? cfg.vatPercent;
      const vat = rate > 0 ? Math.round((amount * rate) / (100 + rate)) : 0;
      const discount =
        orderDiscount > 0 ? Math.round(((orderDiscount * subtotal) / totalSubtotal) * 100) : 0;

      const pos: VcrPosition = {
        name: String(item.productName),
        barcode: String(item.barcode),
        icps: product?.mxik ?? '',
        amount,
        quantity: Math.round(Number(item.quantity) * 1000),
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
    }
    return positions;
  }

  private buildPayments(sale: { paymentMethod: string; finalAmount: unknown }): VcrPayment[] {
    const value = Math.round(Number(sale.finalAmount) * 100);
    // paymentMethod may be 'cash'/'card' (POS quick-pay) or upper-case elsewhere.
    if ((sale.paymentMethod ?? '').toUpperCase() === 'CASH') return [{ type: 1, value }];
    return [{ type: 2, value, card_type: 2 }];
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

    try {
      await this.ensureZReportOpen(client, sale.smenaId);
      const positions = await this.buildPositions(sale as never, cfg);
      const payments = this.buildPayments(sale as never);
      if (FISCAL_DEBUG) {
        console.log('[fiscal] positions:', JSON.stringify(positions));
        console.log('[fiscal] payments:', JSON.stringify(payments));
      }
      await client.validateSale(positions, payments, false);
      const result = await client.sale({
        positions,
        payments,
        code: sale.id, // idempotency key
        session_code: sale.smenaId ?? undefined,
        cashier_name: sale.cashierName,
        pos_id: cfg.posId,
      });
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
      console.error(`[fiscal] ✗ fiscalize ${saleId} failed: ${this.errText(e)}`);
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

  start(): void {
    if (this.worker) return;
    this.worker = setInterval(() => {
      this.processPending().catch((e) =>
        console.error('[fiscal] worker error:', e instanceof Error ? e.message : e),
      );
    }, WORKER_INTERVAL_MS);
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

function safeParseLabels(json: string): FiscalLabel[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
