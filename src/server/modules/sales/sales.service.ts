import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { SyncSaleDto } from './dto/sync-sale.dto';
import { Sale, SaleItem } from '@prisma/client';
import { SaleFilters, SaleWhereInput, SaleUser } from './types/sale.types';

type SaleWithItems = Sale & { items: SaleItem[] };

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private productsService: ProductsService,
  ) {}

  async findAll(storeId: string, filters?: SaleFilters) {
    const where: SaleWhereInput = { storeId };

    if (filters?.cashierId) where.cashierId = filters.cashierId;

    if (filters?.startDate || filters?.endDate) {
      where.createdAt = {};
      if (filters?.startDate) where.createdAt.gte = filters.startDate;
      if (filters?.endDate) where.createdAt.lte = filters.endDate;
    }

    return this.prisma.sale.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      ...(filters?.startDate || filters?.endDate ? {} : { take: 100 }),
    });
  }

  async findById(id: string, storeId: string, user?: SaleUser) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!sale || sale.storeId !== storeId) {
      throw new NotFoundException('Sale not found');
    }

    // Non-admin users can only see their own sales
    if (user && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN' && sale.cashierId !== user.id) {
      throw new ForbiddenException('Access denied');
    }

    return sale;
  }

  async syncFromTerminal(storeId: string, syncSaleDto: SyncSaleDto) {
    // Check if sale already exists (idempotency).
    // Use (storeId, receiptNumber) — not the terminal's local `id` — because the
    // terminal's SQLite auto-increment ID can change after a DB reset/restore,
    // causing the id-based lookup to miss an already-synced sale and crash on create.
    const existing = await this.prisma.sale.findFirst({
      where: { storeId, receiptNumber: syncSaleDto.receiptNumber },
    });

    if (existing) {
      console.log(`[sale-sync] DUPLICATE receipt=${syncSaleDto.receiptNumber}`);
      return { id: existing.id, synced: true, message: 'Already synced' };
    }

    // Resolve server-side productId by barcode (terminal IDs are local SQLite auto-increments)
    const barcodes = [...new Set(syncSaleDto.items.map((i) => i.barcode))];
    const serverProducts = await this.prisma.product.findMany({
      where: { storeId, barcode: { in: barcodes } },
      select: { id: true, barcode: true },
    });
    console.log(`[sale-sync] NEW receipt=${syncSaleDto.receiptNumber} storeId=${storeId} barcodes=${JSON.stringify(barcodes)} found=${serverProducts.length}`);
    const productIdByBarcode = new Map(serverProducts.map((p) => [p.barcode, p.id]));

    // Resolve the VPS cashierId by phone so the sale is attributed to the correct
    // VPS user (terminal user IDs may differ from VPS user IDs if the user was
    // created locally before the first sync).
    let resolvedCashierId = syncSaleDto.cashierId;
    if (syncSaleDto.cashierPhone) {
      const vpsUser = await this.prisma.user.findUnique({
        where: { storeId_phone: { storeId, phone: syncSaleDto.cashierPhone } },
        select: { id: true },
      });
      if (vpsUser) resolvedCashierId = vpsUser.id;
    }

    // Create sale with items
    const sale = await this.prisma.sale.create({
      data: {
        id: syncSaleDto.id,
        storeId,
        receiptNumber: syncSaleDto.receiptNumber,
        totalAmount: syncSaleDto.totalAmount,
        discountAmount: syncSaleDto.discountAmount || '0',
        finalAmount: syncSaleDto.finalAmount,
        paymentMethod: syncSaleDto.paymentMethod,
        cashierId: resolvedCashierId,
        cashierName: syncSaleDto.cashierName,
        terminalId: syncSaleDto.terminalId,
        synced: true,
        syncedAt: new Date(),
        createdAt: new Date(syncSaleDto.createdAt),
        items: {
          create: syncSaleDto.items.map((item) => ({
            id: item.id,
            productId: productIdByBarcode.get(item.barcode) ?? null,
            productName: item.productName,
            barcode: item.barcode,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.subtotal,
            piecesPerUnit: item.piecesPerUnit ?? 1,
          })),
        },
      },
      include: { items: true },
    });

    // Update product stock using server-side product IDs.
    // Use update() (not updateMany) so that @updatedAt is always touched —
    // terminals rely on updatedAt to detect changed products in the next sync pull.
    // Wrapped in try-catch per item so a failed update never causes a 500 response —
    // a 500 would leave the local sale un-synced and cause infinite DUPLICATE retries.
    const saleCreatedAt = new Date(syncSaleDto.createdAt);

    for (const item of syncSaleDto.items) {
      const serverId = productIdByBarcode.get(item.barcode);
      if (!serverId) {
        console.warn(`[sale-sync] No VPS product found for barcode=${item.barcode} — stock NOT decremented for this item`);
        continue;
      }
      // Stock is counted in PIECES but a line's quantity is in SALE units, so a box line
      // (piecesPerUnit = N) must be multiplied out. Terminals older than the box feature
      // omit the field entirely and fall back to 1 — i.e. unchanged behaviour.
      const decrement = parseFloat(item.quantity) * (item.piecesPerUnit ?? 1);

      try {
        // Atomic decrement — GREATEST(0, stock - N) prevents going negative,
        // and the single SQL statement eliminates the T1/T2 race condition that
        // the old read→compute→write pattern had (two concurrent terminals both
        // reading the same stock value and overwriting each other's decrement).
        //
        // The stock_counted_at guard is the stocktake watermark. Completing an
        // InventoryCount writes stock ABSOLUTELY from a physical count, so any sale that
        // happened BEFORE that count is already baked into the counted figure. Without
        // this clause an offline terminal's backlog would decrement a second time on
        // reconnect and understate stock — do not "simplify" it away.
        const affected = await this.prisma.$executeRaw`
          UPDATE products
          SET stock = GREATEST(0, stock - ${decrement}::numeric),
              updated_at = NOW()
          WHERE id = ${serverId}
            AND (stock_counted_at IS NULL
                 OR stock_counted_at < ${saleCreatedAt}::timestamptz)
        `;
        if (affected === 0) {
          console.log(`[sale-sync] Stock NOT decremented: product id=${serverId} barcode=${item.barcode} — sale predates the last stocktake (already counted)`);
        } else {
          console.log(`[sale-sync] Stock decremented: product id=${serverId} barcode=${item.barcode} -${decrement} (atomic)`);
        }
      } catch (stockErr) {
        console.error(`[sale-sync] STOCK UPDATE FAILED for product id=${serverId} barcode=${item.barcode}:`, stockErr instanceof Error ? stockErr.message : stockErr);
      }
    }

    return { id: sale.id, synced: true };
  }

  async deleteById(id: string, storeId: string, user?: SaleUser) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!sale || sale.storeId !== storeId) {
      throw new NotFoundException('Sale not found');
    }

    // Non-admin users can only delete their own sales
    if (user && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN' && sale.cashierId !== user.id) {
      throw new ForbiddenException('Can only delete your own sales');
    }

    // Restore product stock for each item
    for (const item of sale.items) {
      if (!item.productId) continue;
      try {
        const product = await this.prisma.product.findUnique({
          where: { id: item.productId },
          select: { stock: true },
        });
        if (!product) continue;
        const restoredStock = Number(product.stock) + Number(item.quantity);
        await this.prisma.product.update({
          where: { id: item.productId },
          data: { stock: restoredStock },
        });
      } catch (err) {
        console.error(`[sale-delete] Failed to restore stock for productId=${item.productId}:`, err instanceof Error ? err.message : err);
      }
    }

    await this.prisma.sale.delete({ where: { id } });
    return { deleted: true };
  }

  async unbackfillStock(storeId: string) {
    // Reverse the backfill: add total units sold back to each product's stock.
    // The backfill incorrectly assumed VPS stock was never decremented, but
    // syncBulk was already uploading terminal local stock (post-sale values),
    // so the backfill double-decremented. This undoes that.
    const items = await this.prisma.saleItem.findMany({
      where: { sale: { storeId } },
      select: { productId: true, quantity: true },
    });

    const totalSoldById = new Map<number, number>();
    for (const item of items) {
      if (!item.productId) continue;
      const prev = totalSoldById.get(item.productId) ?? 0;
      totalSoldById.set(item.productId, prev + Number(item.quantity));
    }

    let updated = 0;
    for (const [productId, totalSold] of totalSoldById) {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        select: { id: true, stock: true, storeId: true },
      });
      if (!product || product.storeId !== storeId) continue;

      const restoredStock = Number(product.stock) + totalSold;
      await this.prisma.product.update({
        where: { id: productId },
        data: { stock: restoredStock },
      });
      console.log(`[unbackfill] productId=${productId} ${Number(product.stock)} → ${restoredStock} (+${totalSold})`);
      updated++;
    }

    console.log(`[unbackfill] Done: ${updated} products restored`);
    return { updated };
  }

  async getDailySummary(storeId: string, date: Date, cashierId?: string) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const where: SaleWhereInput = {
      storeId,
      createdAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
    };

    if (cashierId) where.cashierId = cashierId;

    const sales = await this.prisma.sale.findMany({
      where,
      include: { items: true },
    });

    const totalSales = sales.length;
    const totalRevenue = sales.reduce(
      (sum: number, sale: SaleWithItems) => sum + Number(sale.finalAmount),
      0,
    );
    const totalItems = sales.reduce(
      (sum: number, sale: SaleWithItems) => sum + sale.items.length,
      0,
    );
    const cashSales = sales.filter((s: SaleWithItems) => s.paymentMethod === 'cash').length;
    const cardSales = sales.filter((s: SaleWithItems) => s.paymentMethod === 'card').length;
    // Counted separately, not folded into cardSales: the three must add up to totalSales,
    // otherwise a UzQR sale disappears from the summary entirely.
    const uzqrSales = sales.filter((s: SaleWithItems) => s.paymentMethod === 'uzqr').length;

    return {
      date: startOfDay.toISOString().split('T')[0],
      totalSales,
      totalRevenue,
      totalItems,
      cashSales,
      cardSales,
      uzqrSales,
      averageTransaction: totalSales > 0 ? totalRevenue / totalSales : 0,
    };
  }
}
