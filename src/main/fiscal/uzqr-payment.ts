import QRCode from 'qrcode';
import { log } from '../logger';
import { VcrError, describeVcrError, UZQR_PAYMENT_SYSTEM_ID } from './regos-vcr-client';
import { regosVcrService } from './regos-vcr-service';
import { decideNextPoll, type PollOptions } from './uzqr-poll';
import type { UzQrStartResult, UzQrFinalResult } from '../../shared/types/fiscal.types';

/**
 * UzQR payment orchestration.
 *
 * The buyer scans a QR and confirms in their own bank app, so this runs as: create an invoice,
 * show the QR, then poll until VCR reports it paid. Only then may the sale be written — see
 * `startUzQrPayment` for why the ordering is not negotiable.
 */

/** VCR is single-threaded; only one QR payment may be in flight at a time. */
let inFlight: { paymentId: string; cancelled: boolean } | null = null;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isUzQrInFlight(): boolean {
  return inFlight !== null;
}

/**
 * Create the QR invoice.
 *
 * Called BEFORE the sale exists. That ordering is deliberate: confirmation takes as long as the
 * buyer takes, and writing the sale first would hold a stock decrement open for minutes and
 * leave a phantom sale behind every time someone walks away from the till.
 */
export async function startUzQrPayment(
  amountTiyin: number,
  description?: string,
): Promise<UzQrStartResult> {
  if (inFlight) {
    // Two QR invoices at once would let the buyer pay the wrong one.
    return { ok: false, error: 'Оплата UzQR уже выполняется' };
  }

  try {
    const created = await regosVcrService.runVcr((client) =>
      client.createPayment({
        payment_system_id: UZQR_PAYMENT_SYSTEM_ID,
        amount: amountTiyin,
        description,
      }),
    );

    if (!created.qr_text) {
      // Without a QR there is nothing for the buyer to scan. Cancel rather than leave a dangling
      // invoice that could later be paid against no receipt.
      await safeCancel(created.id);
      return { ok: false, error: 'REGOS не вернул QR-код для оплаты' };
    }

    inFlight = { paymentId: created.id, cancelled: false };

    // Rendered here rather than in the renderer so no QR dependency has to be added there;
    // `qrcode` is already used by the thermal printer.
    const qrDataUrl = await QRCode.toDataURL(created.qr_text, { margin: 1, width: 512 });

    log.info(`[uzqr] invoice created id=${created.id} invoice_id=${created.invoice_id ?? '-'}`);

    return {
      ok: true,
      vcrPaymentId: created.id,
      qrText: created.qr_text,
      qrDataUrl,
      invoiceId: created.invoice_id ?? null,
      status: created.status,
    };
  } catch (e) {
    inFlight = null;
    return { ok: false, error: errText(e) };
  }
}

/**
 * Poll until the buyer pays, the deadline passes, or the cashier cancels.
 *
 * Each `Payment.Get` is serialized individually through the service rather than holding the VCR
 * lock for the whole loop — the device is single-threaded, and a two-minute exclusive hold would
 * block every other fiscal operation on the terminal for the duration.
 */
export async function pollUzQrPayment(
  vcrPaymentId: string,
  opts: PollOptions,
): Promise<UzQrFinalResult> {
  const startedAt = Date.now();

  try {
    for (;;) {
      if (inFlight?.cancelled) return { ok: false, state: 'CANCELLED' };

      let status: number | null = null;
      let rrn: string | null = null;

      try {
        const p = await regosVcrService.runVcr((client) => client.getPayment(vcrPaymentId));
        status = p.status;
        rrn = p.rrn ?? null;
      } catch (e) {
        // A failed poll is not a failed payment — the buyer may well be mid-confirmation while
        // the VCR is briefly unreachable. Log and let decideNextPoll retry until the deadline.
        log.warn(`[uzqr] poll failed for ${vcrPaymentId}: ${errText(e)}`);
      }

      const decision = decideNextPoll(status, Date.now() - startedAt, opts);

      if (decision.action === 'paid') {
        log.info(`[uzqr] PAID id=${vcrPaymentId} rrn=${rrn ?? '-'}`);
        return { ok: true, state: 'PAID', vcrPaymentId, rrn };
      }
      if (decision.action === 'timeout') {
        log.warn(`[uzqr] timed out waiting for buyer id=${vcrPaymentId}`);
        return { ok: false, state: 'TIMEOUT' };
      }

      await sleep(decision.delayMs);
    }
  } finally {
    inFlight = null;
  }
}

/**
 * Cancel an unpaid invoice.
 *
 * Marks the in-flight poll cancelled first so the loop stops even if VCR is slow to answer.
 */
export async function cancelUzQrPayment(vcrPaymentId: string): Promise<{ ok: boolean; error?: string }> {
  if (inFlight?.paymentId === vcrPaymentId) inFlight.cancelled = true;
  return safeCancel(vcrPaymentId);
}

async function safeCancel(vcrPaymentId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await regosVcrService.runVcr((client) => client.cancelPayment(vcrPaymentId));
    log.info(`[uzqr] cancelled id=${vcrPaymentId}`);
    return { ok: true };
  } catch (e) {
    // 704036 means the buyer already paid, so there is nothing to cancel. Reported as success
    // because the cashier's intent ("stop waiting") is satisfied either way — but logged loudly,
    // since a payment with no receipt is money that needs reconciling.
    if (e instanceof VcrError && e.code === 704036) {
      log.error(
        `[uzqr] CANCEL AFTER PAYMENT id=${vcrPaymentId} — money may have been taken with no receipt`,
      );
      return { ok: true };
    }
    return { ok: false, error: errText(e) };
  }
}

function errText(e: unknown): string {
  if (e instanceof VcrError) return describeVcrError(e.code, e.description);
  return e instanceof Error ? e.message : String(e);
}
