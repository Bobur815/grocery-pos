import { ipcMain } from 'electron';
import { regosVcrService } from '../fiscal/regos-vcr-service';
import {
  startUzQrPayment,
  pollUzQrPayment,
  cancelUzQrPayment,
} from '../fiscal/uzqr-payment';
import type { UzQrStartResult, UzQrFinalResult } from '../../shared/types/fiscal.types';

/**
 * UzQR IPC.
 *
 * `uzqr:await` is a single long-lived invoke rather than a renderer-driven polling loop: the
 * poll cadence and deadline are server-side settings, and letting the renderer drive them would
 * put a second, unsynchronised caller on a single-threaded device.
 */
export function setupUzQrHandlers(): void {
  /** Whether the checkout screens should route UzQR through the QR modal at all. */
  ipcMain.handle('uzqr:isEnabled', async (): Promise<boolean> => {
    try {
      return (await regosVcrService.getUzQrConfig()).enabled;
    } catch {
      // Never let a config read failure block a sale — fall back to the plain tender.
      return false;
    }
  });

  ipcMain.handle(
    'uzqr:start',
    async (_event, amountSum: number): Promise<UzQrStartResult> => {
      // Amounts cross the VCR boundary in tiyin, matching buildPositions/buildPayments.
      const amountTiyin = Math.round(Number(amountSum) * 100);
      if (!Number.isFinite(amountTiyin) || amountTiyin <= 0) {
        return { ok: false, error: 'Некорректная сумма для оплаты' };
      }
      return startUzQrPayment(amountTiyin);
    },
  );

  ipcMain.handle(
    'uzqr:await',
    async (_event, vcrPaymentId: string): Promise<UzQrFinalResult> => {
      const { intervalMs, timeoutMs } = await regosVcrService.getUzQrConfig();
      return pollUzQrPayment(vcrPaymentId, { intervalMs, timeoutMs });
    },
  );

  ipcMain.handle('uzqr:cancel', async (_event, vcrPaymentId: string) => {
    return cancelUzQrPayment(vcrPaymentId);
  });
}
