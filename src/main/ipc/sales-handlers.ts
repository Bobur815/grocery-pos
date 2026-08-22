import { ipcMain } from 'electron';
import { getPrismaClient } from '../database/sqlite-client';
import { getCurrentUser } from './auth-handlers';
import { getAppConfig } from '../config/app-config';
import { getServerToken } from '../sync/queue-manager';
import { regosVcrService } from '../fiscal/regos-vcr-service';
import { savePendingMarkingCodes } from './marking-codes-handlers';
import { format } from 'date-fns';
import { randomUUID } from 'node:crypto';
import { toPieces } from '../../shared/utils/pack';
import type { Sale, SaleItem as PrismaSaleItem } from '../../generated/prisma-sqlite';

function ipcSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function setupSalesHandlers(): void {
  ipcMain.handle('sales:create', async (_event, data) => {
    const currentUser = getCurrentUser();
    if (!currentUser) {
      throw new Error('Not authenticated');
    }

    const prisma = getPrismaClient();
    const config = getAppConfig();

    // Check stock availability for all items. Stock is counted in PIECES while a line's
    // quantity is in SALE units, so a box line must be converted before comparing.
    for (const item of data.items as Array<{
      productId: number | string;
      quantity: number;
      piecesPerUnit?: number;
    }>) {
      const product = await prisma.product.findUnique({
        where: { id: Number(item.productId) },
        select: { id: true, nameRu: true, stock: true, active: true },
      });

      if (!product) {
        throw new Error(JSON.stringify({ code: 'PRODUCT_NOT_FOUND', productId: item.productId }));
      }

      if (!product.active) {
        throw new Error(JSON.stringify({ code: 'PRODUCT_INACTIVE', name: product.nameRu }));
      }

      const piecesNeeded = toPieces(item.quantity, item.piecesPerUnit);
      if (Number(product.stock) < piecesNeeded) {
        throw new Error(JSON.stringify({
          code: 'INSUFFICIENT_STOCK',
          name: product.nameRu,
          available: Number(product.stock),
          requested: piecesNeeded,
        }));
      }
    }

    // Hard-block if no smena is open
    const currentSmena = await prisma.smena.findFirst({
      where: { terminalId: config.terminalId, status: 'OPEN' },
      select: { id: true },
    });
    if (!currentSmena) {
      throw new Error(JSON.stringify({ code: 'NO_SMENA_OPEN' }));
    }

    // Calculate totals
    let totalAmount = 0;
    const items = data.items.map((item: {
      productId: number | string;
      productName: string;
      barcode: string;
      quantity: number;
      unitPrice: number;
      piecesPerUnit?: number;
      preWeighedItemId?: string;
    }) => {
      const subtotal = item.quantity * item.unitPrice;
      totalAmount += subtotal;
      return {
        productId: Number(item.productId),
        productName: item.productName,
        barcode: item.barcode,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal,
        piecesPerUnit: item.piecesPerUnit ?? 1,
        // Keep preWeighedItemId for post-sale update (not stored in DB SaleItem)
        preWeighedItemId: item.preWeighedItemId,
      };
    });

    const discountAmount = data.discountAmount || 0;
    const finalAmount = totalAmount - discountAmount;
    // Generate receipt number
    const receiptNumber = await generateReceiptNumber(config.terminalId);

    // Create sale with items
    const sale = await prisma.sale.create({
      data: {
        receiptNumber,
        totalAmount,
        discountAmount,
        finalAmount,
        paymentMethod: data.paymentMethod,
        cashierId: currentUser.id,
        cashierName: currentUser.nameRu,
        terminalId: config.terminalId,
        smenaId: currentSmena.id,
        synced: false,
        items: {
          create: items,
        },
      },
      include: { items: true },
    });

    // Update product stock and check for pending price changes
    for (const item of items) {
      await prisma.product.update({
        where: { id: item.productId },
        data: {
          stock: { decrement: toPieces(item.quantity, item.piecesPerUnit) },
        },
      });

      // Check if pending price should be applied
      const updatedProduct = await prisma.product.findUnique({
        where: { id: item.productId },
        select: { stock: true, pendingPrice: true, pendingPriceThreshold: true },
      });

      if (
        updatedProduct?.pendingPrice != null &&
        updatedProduct?.pendingPriceThreshold != null &&
        Number(updatedProduct.stock) <= Number(updatedProduct.pendingPriceThreshold)
      ) {
        await prisma.product.update({
          where: { id: item.productId },
          data: {
            price: updatedProduct.pendingPrice,
            pendingPrice: null,
            pendingPriceThreshold: null,
          },
        });
      }
    }

    // Mark any pre-weighed items as SOLD
    for (const item of data.items as Array<{
      productId: number | string;
      quantity: number;
      preWeighedItemId?: string;
    }>) {
      if (item.preWeighedItemId) {
        await prisma.preWeighedItem.update({
          where: { id: item.preWeighedItemId },
          data: { status: 'SOLD', soldAt: new Date(), saleId: sale.id },
        }).catch(() => {
          // Item may have already been marked sold or not exist — not fatal
        });
      }
    }

    // Snapshot the scanned group-020/022 marking labels on the sale row, ALWAYS — not only when
    // fiscalization is enabled. sale.regosLabels is the authoritative sale→marking-code link that
    // markingCodes:removeForSale reads to free the SoldMarkingCode rows when this receipt is later
    // deleted or refunded, so the items can be sold again (the stored label equals SoldMarkingCode.
    // code). Persisting it synchronously here — rather than relying on the fire-and-forget
    // savePendingMarkingCodes below — also avoids a race where a quick delete runs before that
    // pending row is written.
    const markingLabels = (data.markingCodes as Array<{ barcode: string; label: string }> | undefined)
      ?.filter((l) => l?.barcode && l?.label) ?? [];
    const regosLabels = markingLabels.length ? JSON.stringify(markingLabels) : null;

    // REGOS:VCR fiscalization — opt-in per sale. The sale is always saved as PENDING; it is only
    // sent to the OFD now when the cashier ticked "fiscalize" at checkout (data.fiscalize). Otherwise
    // it stays PENDING (un-fiscalized) and can be fiscalized later from Sales History. When fiscalizing,
    // the OFD round-trip runs in the BACKGROUND so the cashier is not blocked; the fiscal QR is
    // persisted when it completes, and on failure the sale stays PENDING/FAILED.
    try {
      if (await regosVcrService.isEnabled()) {
        await prisma.sale.update({
          where: { id: sale.id },
          data: { fiscalStatus: 'PENDING', regosLabels },
        });
        if (data.fiscalize) {
          // Fire-and-forget: kick the device immediately but do not await the OFD round-trip.
          regosVcrService.fiscalizeSale(sale.id).catch((e) =>
            console.error('[fiscal] immediate fiscalize failed (will retry):', e instanceof Error ? e.message : e),
          );
        }
      } else {
        await prisma.sale.update({
          where: { id: sale.id },
          data: { fiscalStatus: 'DISABLED', regosLabels },
        });
      }
    } catch (e) {
      console.error('[fiscal] enqueue failed:', e instanceof Error ? e.message : e);
    }

    // Capture the sale's group-022 marking codes for later REGOS:VCR out-of-circulation
    // fiscalization (no VCR connected yet). No asl-belgisi lookup happens here — circulation is
    // checked on the /marking-check screen, not during a sale. Fire-and-forget anyway: the local
    // write is followed by a best-effort VPS sync, and neither may delay the sale/receipt.
    if (markingLabels.length > 0) {
      savePendingMarkingCodes(
        markingLabels.map((m) => ({ code: m.label, productBarcode: m.barcode, saleId: sale.id })),
      ).catch((e) =>
        console.error('[marking] savePending failed:', e instanceof Error ? e.message : e),
      );
    }

    return ipcSafe(sale);
  });

  ipcMain.handle('sales:getAll', async (_event, filters) => {
    const currentUser = getCurrentUser();
    if (!currentUser) {
      throw new Error('Not authenticated');
    }

    const prisma = getPrismaClient();

    const where: Record<string, unknown> = {};

    // Non-admin users can only see their own sales
    if (currentUser.role !== 'ADMIN') {
      where.cashierId = currentUser.id;
    }

    if (filters?.startDate) {
      where.createdAt = {
        ...(where.createdAt as Record<string, Date> || {}),
        gte: new Date(filters.startDate),
      };
    }

    if (filters?.endDate) {
      where.createdAt = {
        ...(where.createdAt as Record<string, Date> || {}),
        lte: new Date(filters.endDate),
      };
    }

    if (filters?.cashierId && currentUser.role === 'ADMIN') {
      where.cashierId = filters.cashierId;
    }

    if (filters?.terminalId && currentUser.role === 'ADMIN') {
      where.terminalId = filters.terminalId;
    }

    const sales = await prisma.sale.findMany({
      where,
      include: { items: { include: { product: { select: { cost: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const salesWithMargin = (sales as Array<Sale & { items: Array<PrismaSaleItem & { product: { cost: unknown } | null }> }>).map((sale) => {
      const totalCost = sale.items.reduce((sum, item) => {
        const cost = item.product?.cost ? Number(item.product.cost) : 0;
        return sum + cost * Number(item.quantity) * (item.piecesPerUnit ?? 1);
      }, 0);
      const finalAmount = Number(sale.finalAmount);
      const margin = finalAmount > 0 ? ((finalAmount - totalCost) / finalAmount) * 100 : 0;
      return { ...sale, totalCost, margin };
    });

    return ipcSafe(salesWithMargin);
  });

  ipcMain.handle('sales:getById', async (_event, id: string) => {
    const currentUser = getCurrentUser();
    if (!currentUser) {
      throw new Error('Not authenticated');
    }

    const prisma = getPrismaClient();

    const sale = await prisma.sale.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!sale) {
      throw new Error('Sale not found');
    }

    // Non-admin users can only see their own sales
    if (currentUser.role !== 'ADMIN' && sale.cashierId !== currentUser.id) {
      throw new Error('Unauthorized');
    }

    return ipcSafe(sale);
  });

  ipcMain.handle('sales:update', async (_event, saleId: string, data) => {
    const currentUser = getCurrentUser();
    if (!currentUser) {
      throw new Error('Not authenticated');
    }

    const prisma = getPrismaClient();

    const existingSale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true },
    });

    if (!existingSale) {
      throw new Error('Sale not found');
    }

    if (currentUser.role !== 'ADMIN' && existingSale.cashierId !== currentUser.id) {
      throw new Error('Unauthorized');
    }

    // Restore stock from old items (in pieces — a box line held piecesPerUnit of them)
    for (const oldItem of existingSale.items) {
      await prisma.product.update({
        where: { id: oldItem.productId },
        data: {
          stock: { increment: toPieces(Number(oldItem.quantity), oldItem.piecesPerUnit) },
        },
      });
    }

    // Check stock availability for new items (after restoring old stock)
    for (const item of data.items as Array<{
      productId: number | string;
      quantity: number;
      piecesPerUnit?: number;
    }>) {
      const product = await prisma.product.findUnique({
        where: { id: Number(item.productId) },
        select: { id: true, nameRu: true, stock: true, active: true },
      });

      if (!product) {
        throw new Error(JSON.stringify({ code: 'PRODUCT_NOT_FOUND', productId: item.productId }));
      }

      if (!product.active) {
        throw new Error(JSON.stringify({ code: 'PRODUCT_INACTIVE', name: product.nameRu }));
      }

      const piecesNeeded = toPieces(item.quantity, item.piecesPerUnit);
      if (Number(product.stock) < piecesNeeded) {
        throw new Error(JSON.stringify({
          code: 'INSUFFICIENT_STOCK',
          name: product.nameRu,
          available: Number(product.stock),
          requested: piecesNeeded,
        }));
      }
    }

    // Calculate new totals
    let totalAmount = 0;
    const newItems = data.items.map((item: {
      productId: number | string;
      productName: string;
      barcode: string;
      quantity: number;
      unitPrice: number;
      piecesPerUnit?: number;
    }) => {
      const subtotal = item.quantity * item.unitPrice;
      totalAmount += subtotal;
      return {
        productId: Number(item.productId),
        productName: item.productName,
        barcode: item.barcode,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal,
        piecesPerUnit: item.piecesPerUnit ?? 1,
      };
    });

    const discountAmount = data.discountAmount || 0;
    const finalAmount = totalAmount - discountAmount;

    // Delete old items, update sale, create new items
    await prisma.saleItem.deleteMany({ where: { saleId } });

    const updatedSale = await prisma.sale.update({
      where: { id: saleId },
      data: {
        totalAmount,
        discountAmount,
        finalAmount,
        paymentMethod: data.paymentMethod,
        synced: false,
        items: {
          create: newItems,
        },
      },
      include: { items: true },
    });

    // Decrement stock for new items and check pending price
    for (const item of newItems) {
      await prisma.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: toPieces(item.quantity, item.piecesPerUnit) } },
      });

      const updatedProduct = await prisma.product.findUnique({
        where: { id: item.productId },
        select: { stock: true, pendingPrice: true, pendingPriceThreshold: true },
      });

      if (
        updatedProduct?.pendingPrice != null &&
        updatedProduct?.pendingPriceThreshold != null &&
        Number(updatedProduct.stock) <= Number(updatedProduct.pendingPriceThreshold)
      ) {
        await prisma.product.update({
          where: { id: item.productId },
          data: {
            price: updatedProduct.pendingPrice,
            pendingPrice: null,
            pendingPriceThreshold: null,
          },
        });
      }
    }

    return ipcSafe(updatedSale);
  });

  ipcMain.handle('sales:delete', async (_event, saleId: string) => {
    const currentUser = getCurrentUser();
    if (!currentUser) {
      throw new Error('Not authenticated');
    }

    const prisma = getPrismaClient();

    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true },
    });

    if (!sale) {
      throw new Error('Sale not found');
    }

    if (currentUser.role !== 'ADMIN' && sale.cashierId !== currentUser.id) {
      throw new Error('Unauthorized');
    }

    // Restore stock for all items (in pieces — a box line held piecesPerUnit of them)
    for (const item of sale.items) {
      await prisma.product.update({
        where: { id: item.productId },
        data: {
          stock: { increment: toPieces(Number(item.quantity), item.piecesPerUnit) },
        },
      });
    }

    // Delete items then sale
    await prisma.saleItem.deleteMany({ where: { saleId } });
    await prisma.sale.delete({ where: { id: saleId } });

    // If the sale was already synced to VPS, delete it there too so the
    // receipt number is freed and stock is restored on the server.
    if (sale.synced) {
      try {
        const appConfig = getAppConfig();
        const token = getServerToken();
        if (token) {
          const res = await fetch(`${appConfig.vpsApiUrl}/sales/${saleId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) {
            console.error(`[sales:delete] VPS delete failed for sale ${saleId}: HTTP ${res.status}`);
          }
        }
      } catch (err) {
        console.error(`[sales:delete] VPS delete error for sale ${saleId}:`, err instanceof Error ? err.message : err);
      }
    }

    // Record the deletion in the local audit_logs table — kept solely so the shift Z/X-report can
    // count returns (deleted sales). The details JSON keys (finalAmount, smenaId) are read back by
    // computeSmenaStats() in smena-handlers.ts; do not rename them. Written via raw SQL because the
    // Prisma AuditLog model was removed.
    await prisma.$executeRawUnsafe(
      `INSERT INTO audit_logs (id, user_id, phone, action, entity, entity_id, details)
       VALUES (?, ?, ?, 'delete_sale', 'sale', ?, ?)`,
      randomUUID(),
      currentUser.id,
      currentUser.phone,
      saleId,
      JSON.stringify({
        receiptNumber: sale.receiptNumber,
        totalAmount: Number(sale.finalAmount),
        finalAmount: Number(sale.finalAmount),
        smenaId: (sale as { smenaId?: string | null }).smenaId ?? null,
        itemCount: sale.items.length,
      }),
    );

    return true;
  });

  ipcMain.handle('sales:getTodaySummary', async () => {
    const currentUser = getCurrentUser();
    if (!currentUser) {
      throw new Error('Not authenticated');
    }

    const prisma = getPrismaClient();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const where: Record<string, unknown> = {
      createdAt: {
        gte: today,
        lt: tomorrow,
      },
    };

    // Non-admin users can only see their own sales
    if (currentUser.role !== 'ADMIN') {
      where.cashierId = currentUser.id;
    }

    const sales = await prisma.sale.findMany({
      where,
      include: { items: true },
    });

    const totalSales = sales.length;
    const totalRevenue = sales.reduce(
      (sum: number, sale: Sale & { items: PrismaSaleItem[] }) => sum + Number(sale.finalAmount),
      0
    );
    const totalItems = sales.reduce(
      (sum: number, sale: Sale & { items: PrismaSaleItem[] }) => sum + sale.items.length,
      0
    );
    const cashSales = sales.filter((s: Sale & { items: PrismaSaleItem[] }) => s.paymentMethod === 'cash').length;
    const cardSales = sales.filter((s: Sale & { items: PrismaSaleItem[] }) => s.paymentMethod === 'card').length;
    // Counted separately, not folded into cardSales: these three must still add up to
    // totalSales, otherwise a UzQR sale disappears from the summary entirely.
    const uzqrSales = sales.filter((s: Sale & { items: PrismaSaleItem[] }) => s.paymentMethod === 'uzqr').length;

    return {
      date: format(today, 'yyyy-MM-dd'),
      totalSales,
      totalRevenue,
      totalItems,
      cashSales,
      cardSales,
      uzqrSales,
      averageTransaction: totalSales > 0 ? totalRevenue / totalSales : 0,
    };
  });
}

ipcMain.handle('analytics:getData', async (_event, filters: {
  startDate: string;
  endDate: string;
  terminalId?: string;
}) => {
  const prisma = getPrismaClient();
  // Prisma/SQLite stores DateTime as integer milliseconds since epoch
  const startMs = new Date(filters.startDate).getTime();
  const endMs = new Date(filters.endDate).getTime();

  // Build optional terminal filter clause for direct sales queries
  const terminalClause = filters.terminalId ? ` AND terminal_id = '${filters.terminalId.replace(/'/g, "''")}'` : '';
  // Same clause prefixed for join queries where sales table is aliased as 's'
  const terminalClauseS = filters.terminalId ? ` AND s.terminal_id = '${filters.terminalId.replace(/'/g, "''")}'` : '';

  const [salesTrend, salesByCategory, hourlyDist, topProducts, cashierPerf, profitMargins, summary] = await Promise.all([
    prisma.$queryRawUnsafe(`
      SELECT DATE(datetime(created_at/1000, 'unixepoch', 'localtime')) as date,
             CAST(SUM(final_amount) AS REAL) as revenue,
             CAST(COUNT(*) AS REAL) as count
      FROM sales
      WHERE created_at >= ? AND created_at <= ?${terminalClause}
      GROUP BY DATE(datetime(created_at/1000, 'unixepoch', 'localtime'))
      ORDER BY date ASC
    `, startMs, endMs),

    prisma.$queryRawUnsafe(`
      SELECT COALESCE(c.name_ru, 'Без категории') as categoryRu,
             COALESCE(c.name_uz, 'Kategoriyasiz') as categoryUz,
             CAST(SUM(si.subtotal) AS REAL) as revenue,
             CAST(SUM(si.quantity * si.pieces_per_unit) AS REAL) as quantity
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE s.created_at >= ? AND s.created_at <= ?${terminalClauseS}
      GROUP BY c.id
      ORDER BY revenue DESC
      LIMIT 10
    `, startMs, endMs),

    prisma.$queryRawUnsafe(`
      SELECT CAST(strftime('%H', datetime(created_at/1000, 'unixepoch', 'localtime')) AS INTEGER) as hour,
             CAST(SUM(final_amount) AS REAL) as revenue,
             CAST(COUNT(*) AS REAL) as count
      FROM sales
      WHERE created_at >= ? AND created_at <= ?${terminalClause}
      GROUP BY strftime('%H', datetime(created_at/1000, 'unixepoch', 'localtime'))
      ORDER BY hour ASC
    `, startMs, endMs),

    prisma.$queryRawUnsafe(`
      SELECT si.product_name as name,
             CAST(SUM(si.quantity * si.pieces_per_unit) AS REAL) as quantity,
             CAST(SUM(si.subtotal) AS REAL) as revenue
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE s.created_at >= ? AND s.created_at <= ?${terminalClauseS}
      GROUP BY si.product_id
      ORDER BY quantity DESC
      LIMIT 10
    `, startMs, endMs),

    prisma.$queryRawUnsafe(`
      SELECT cashier_name as name,
             CAST(SUM(final_amount) AS REAL) as revenue,
             CAST(COUNT(*) AS REAL) as count
      FROM sales
      WHERE created_at >= ? AND created_at <= ?${terminalClause}
      GROUP BY cashier_id
      ORDER BY revenue DESC
    `, startMs, endMs),

    prisma.$queryRawUnsafe(`
      SELECT COALESCE(c.name_ru, 'Без категории') as categoryRu,
             COALESCE(c.name_uz, 'Kategoriyasiz') as categoryUz,
             CAST(SUM(si.subtotal) AS REAL) as revenue,
             CAST(SUM(si.quantity * si.pieces_per_unit * COALESCE(p.cost, 0)) AS REAL) as cost
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      JOIN products p ON si.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE s.created_at >= ? AND s.created_at <= ?${terminalClauseS}
      GROUP BY c.id
      ORDER BY revenue DESC
      LIMIT 10
    `, startMs, endMs),

    prisma.$queryRawUnsafe(`
      SELECT CAST(COUNT(*) AS REAL) as totalSales,
             CAST(SUM(final_amount) AS REAL) as totalRevenue,
             CAST(SUM(CASE WHEN payment_method = 'cash' THEN 1 ELSE 0 END) AS REAL) as cashSales,
             CAST(SUM(CASE WHEN payment_method = 'card' THEN 1 ELSE 0 END) AS REAL) as cardSales,
             CAST(SUM(CASE WHEN payment_method = 'uzqr' THEN 1 ELSE 0 END) AS REAL) as uzqrSales
      FROM sales
      WHERE created_at >= ? AND created_at <= ?${terminalClause}
    `, startMs, endMs),
  ]);

  const summaryRow = (summary as any[])[0] || {};

  return ipcSafe({
    salesTrend: (salesTrend as any[]).map(r => ({
      date: String(r.date || ''),
      revenue: Number(r.revenue || 0),
      count: Number(r.count || 0),
    })),
    salesByCategory: (salesByCategory as any[]).map(r => ({
      categoryRu: String(r.categoryRu || ''),
      categoryUz: String(r.categoryUz || ''),
      revenue: Number(r.revenue || 0),
      quantity: Number(r.quantity || 0),
    })),
    hourlyDistribution: (hourlyDist as any[]).map(r => ({
      hour: Number(r.hour || 0),
      revenue: Number(r.revenue || 0),
      count: Number(r.count || 0),
    })),
    topProducts: (topProducts as any[]).map(r => ({
      name: String(r.name || ''),
      quantity: Number(r.quantity || 0),
      revenue: Number(r.revenue || 0),
    })),
    cashierPerformance: (cashierPerf as any[]).map(r => ({
      name: String(r.name || ''),
      revenue: Number(r.revenue || 0),
      count: Number(r.count || 0),
    })),
    profitMargins: (profitMargins as any[]).map(r => ({
      categoryRu: String(r.categoryRu || ''),
      categoryUz: String(r.categoryUz || ''),
      revenue: Number(r.revenue || 0),
      cost: Number(r.cost || 0),
    })),
    summary: {
      totalSales: Number(summaryRow.totalSales || 0),
      totalRevenue: Number(summaryRow.totalRevenue || 0),
      cashSales: Number(summaryRow.cashSales || 0),
      cardSales: Number(summaryRow.cardSales || 0),
      uzqrSales: Number(summaryRow.uzqrSales || 0),
      averageTransaction:
        Number(summaryRow.totalSales || 0) > 0
          ? Number(summaryRow.totalRevenue || 0) / Number(summaryRow.totalSales || 0)
          : 0,
    },
  });
});

ipcMain.handle('terminals:getKnown', async () => {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRaw<{ terminal_id: string }[]>`
    SELECT DISTINCT terminal_id FROM sales ORDER BY terminal_id
  `;
  return rows.map((r: { terminal_id: string }) => r.terminal_id);
});

ipcMain.handle('terminals:getStatus', async () => {
  const config = getAppConfig();
  const token = getServerToken();
  if (!token) return [];

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      `${config.vpsApiUrl}/terminals/status?storeId=${encodeURIComponent(config.storeId)}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }
    );
    clearTimeout(timeoutId);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
});

// Module-level mutex: ensures only one generateReceiptNumber call runs at a time.
// SQLite's DEFERRED transactions don't prevent concurrent reads from different
// async calls in the same Node.js process, so we serialize at the JS level instead.
let receiptNumberMutex = Promise.resolve();

async function generateReceiptNumber(terminalId: string): Promise<string> {
  let resolveOuter!: (value: string) => void;
  let rejectOuter!: (reason: unknown) => void;
  const outerPromise = new Promise<string>((resolve, reject) => {
    resolveOuter = resolve;
    rejectOuter = reject;
  });

  receiptNumberMutex = receiptNumberMutex.then(async () => {
    try {
      const result = await _generateReceiptNumber(terminalId);
      resolveOuter(result);
    } catch (e) {
      rejectOuter(e);
    }
  });

  return outerPromise;
}

async function _generateReceiptNumber(terminalId: string): Promise<string> {
  const prisma = getPrismaClient();
  const now = new Date();
  const dateStr = format(now, 'yyMMdd');
  const prefix = `${terminalId}${dateStr}`;
  const counterKey = `receipt_seq_${terminalId}_${dateStr}`;

  const stored = await prisma.systemSetting.findUnique({ where: { key: counterKey } });
  let storedSeq = stored ? parseInt(stored.value, 10) : 0;

  // Always verify the counter against actual DB max — self-heals if counter got
  // corrupted by a previous race condition (stuck pointing at an existing receipt).
  const existing = await prisma.sale.findMany({
    where: { receiptNumber: { startsWith: prefix } },
    select: { receiptNumber: true },
  });
  for (const row of existing) {
    const seq = parseInt(row.receiptNumber.slice(prefix.length), 10);
    if (!isNaN(seq) && seq > storedSeq) storedSeq = seq;
  }

  const next = storedSeq + 1;

  await prisma.systemSetting.upsert({
    where: { key: counterKey },
    update: { value: next.toString() },
    create: { key: counterKey, value: next.toString() },
  });

  return `${prefix}${next.toString().padStart(3, '0')}`;
}
