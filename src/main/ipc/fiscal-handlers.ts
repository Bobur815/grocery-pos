import { ipcMain } from 'electron';
import { regosVcrService } from '../fiscal/regos-vcr-service';
import type { RegosVcrConfigInput } from '../../shared/types/fiscal.types';

export function setupFiscalHandlers(): void {
  ipcMain.handle('fiscal:getConfig', async () => regosVcrService.getConfig());

  ipcMain.handle('fiscal:setConfig', async (_event, input: RegosVcrConfigInput) =>
    regosVcrService.setConfig(input),
  );

  ipcMain.handle('fiscal:testConnection', async () => regosVcrService.testConnection());

  ipcMain.handle('fiscal:getStatus', async () => regosVcrService.getQueueStatus());

  ipcMain.handle('fiscal:retrySale', async (_event, saleId: string) =>
    regosVcrService.retrySale(saleId),
  );

  // Bulk: fiscalise all old (group-022) receipts and disable the rest. Manual replacement for
  // the removed background retry worker.
  ipcMain.handle('fiscal:fiscalizeOld', async () => regosVcrService.fiscalizeOldReceipts());

  ipcMain.handle('fiscal:refund', async (_event, saleId: string) =>
    regosVcrService.refundSale(saleId),
  );

  ipcMain.handle('fiscal:printDuplicate', async (_event, saleId: string) =>
    regosVcrService.printDuplicate(saleId),
  );

  // Z-report (fiscal shift) — status + manual open/close for the Smena page.
  ipcMain.handle('fiscal:zInfo', async () => regosVcrService.getZReportInfo());
  ipcMain.handle('fiscal:zOpen', async () => regosVcrService.openZReportManual());
  ipcMain.handle('fiscal:zClose', async () => regosVcrService.closeZReportManual());
}
