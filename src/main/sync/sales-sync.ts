import { getPrismaClient } from '../database/sqlite-client';
import { getAppConfig } from '../config/app-config';
import { getServerToken } from './queue-manager';
import type { Sale, SaleItem } from '../../generated/prisma-sqlite';

type SaleWithItems = Sale & { items: SaleItem[] };

const BATCH_SIZE = 50;

export interface SalesSyncResult {
  totalUnsynced: number;
  attempted: number;
  succeeded: number;
  failed: number;
  skippedReason?: string;
  errors: string[];
}

export async function syncSales(): Promise<SalesSyncResult> {
  const prisma = getPrismaClient();
  const config = getAppConfig();
  const result: SalesSyncResult = { totalUnsynced: 0, attempted: 0, succeeded: 0, failed: 0, errors: [] };

  // Get unsynced sales
  const unsyncedSales: SaleWithItems[] = await prisma.sale.findMany({
    where: { synced: false },
    include: { items: true },
    take: BATCH_SIZE,
    orderBy: { createdAt: 'asc' },
  });

  result.totalUnsynced = unsyncedSales.length;

  if (unsyncedSales.length === 0) {
    return result;
  }

  const token = getServerToken();
  if (!token) {
    result.skippedReason = 'no_server_token';
    console.warn('[sales-sync] No server token available — skipping sync (user must log in first)');
    return result;
  }

  let successCount = 0;
  let failCount = 0;

  // Pre-build a cashierId → phone map so the VPS can resolve the correct VPS user ID
  const cashierIds = [...new Set(
    unsyncedSales.map((s) => s.cashierId).filter((id): id is string => Boolean(id))
  )];
  const cashierUsers: { id: string; phone: string }[] = await prisma.user.findMany({
    where: { id: { in: cashierIds } },
    select: { id: true, phone: true },
  });
  const cashierPhoneById = new Map(cashierUsers.map((u) => [u.id, u.phone]));

  for (const sale of unsyncedSales) {
    try {
      const response = await fetch(`${config.vpsApiUrl}/sales/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: sale.id,
          receiptNumber: sale.receiptNumber,
          totalAmount: sale.totalAmount.toString(),
          discountAmount: sale.discountAmount.toString(),
          finalAmount: sale.finalAmount.toString(),
          paymentMethod: sale.paymentMethod,
          cashierId: sale.cashierId,
          cashierName: sale.cashierName || sale.cashierId,
          cashierPhone: sale.cashierId ? (cashierPhoneById.get(sale.cashierId) ?? undefined) : undefined,
          terminalId: config.terminalId,
          createdAt: sale.createdAt.toISOString(),
          items: sale.items.map((item: typeof sale.items[number]) => ({
            id: item.id,
            productId: item.productId,
            productName: item.productName,
            barcode: item.barcode,
            quantity: item.quantity.toString(),
            unitPrice: item.unitPrice.toString(),
            subtotal: item.subtotal.toString(),
            piecesPerUnit: item.piecesPerUnit ?? 1,
          })),
        }),
      });

      result.attempted++;

      if (response.ok) {
        // Mark as synced
        await prisma.sale.update({
          where: { id: sale.id },
          data: { synced: true, syncedAt: new Date() },
        });
        successCount++;
      } else {
        const errorText = await response.text();
        // Only treat as already-synced when the server explicitly says so (409)
        // or the error is clearly a duplicate receiptNumber/id constraint.
        // Use a strict check to avoid false-positives from unrelated 500 errors.
        const isDuplicate =
          response.status === 409 ||
          (response.status >= 500 &&
            (errorText.includes(`"receiptNumber"`) || errorText.includes('"id"')) &&
            errorText.includes('Unique constraint'));

        if (isDuplicate) {
          await prisma.sale.update({
            where: { id: sale.id },
            data: { synced: true, syncedAt: new Date() },
          });
          successCount++;
        } else {
          const msg = `${sale.receiptNumber} → HTTP ${response.status}: ${errorText.slice(0, 200)}`;
          console.error(`[sales-sync] Failed to sync sale: ${msg}`);
          result.errors.push(msg);
          failCount++;
        }
      }
    } catch (error) {
      const msg = `${sale.receiptNumber} → ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[sales-sync] Error syncing sale: ${msg}`);
      result.errors.push(msg);
      failCount++;
    }
  }

  result.succeeded = successCount;
  result.failed = failCount;

  console.log(`[sales-sync] Done: ${successCount} synced, ${failCount} failed out of ${unsyncedSales.length} pending`);

  // Update last sync timestamp
  await prisma.systemSetting.upsert({
    where: { key: 'last_sale_sync' },
    update: { value: new Date().toISOString() },
    create: { key: 'last_sale_sync', value: new Date().toISOString() },
  });

  return result;
}
