import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MovementSource,
  StockMovementService,
} from '../stock-movement/stock-movement.service';
import {
  computeBookQty,
  computeVariance,
  crossCheck,
  type CrossCheckRow,
  type LedgerRow,
  type ProductVariance,
} from './reconciliation.math';

const ZERO = new Prisma.Decimal(0);

export interface GoodsReconciliation {
  periodStart: Date | null;
  periodEnd: Date;
  countId: string | null;
  lines: (ProductVariance & { productName: string; barcode: string; unit: string })[];
  totals: {
    shortageQtyLines: number;
    surplusQtyLines: number;
    varianceCost: Prisma.Decimal;
    varianceRetail: Prisma.Decimal;
  };
  /** Reported apart from variance on purpose — this is a bug signal, not shrinkage. */
  crossCheck: {
    clean: boolean;
    rows: (CrossCheckRow & { productName: string; barcode: string })[];
  };
  ledgerEnabled: boolean;
}

/**
 * Goods reconciliation: per SKU, in quantities.
 *
 * Read-only over existing data. Reconciles against the ledger rather than recomputing from
 * sales and arrivals directly, because those tables lose their history — a deleted sale takes
 * its SaleItem rows with it, and a stocktake overwrites stock absolutely.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private prisma: PrismaService,
    private stockMovements: StockMovementService,
  ) {}

  /**
   * Seed one OPENING movement per product from current stock.
   *
   * Deliberately a fresh snapshot rather than a historical reconstruction: rebuilding the past
   * would have to model the stock_counted_at watermark and the sales that were hard-deleted
   * along the way, and would produce a history that never reconciles. A dated opening balance
   * is honest about starting from today.
   *
   * Re-runnable — the ledger's (source_type, source_id, product_id, type) unique index turns a
   * second run into a no-op rather than doubling everyone's opening stock.
   */
  async seedOpening(storeId: string, occurredAt = new Date(), actorId?: string) {
    const products = await this.prisma.product.findMany({
      where: { storeId, active: true },
      select: { id: true, stock: true, cost: true, price: true },
    });

    await this.stockMovements.emitStandalone(
      products.map((p) => ({
        storeId,
        productId: p.id,
        type: 'OPENING' as const,
        quantity: p.stock,
        balanceAfter: p.stock, // an opening balance is itself an absolute anchor
        unitCost: p.cost,
        unitPrice: p.price,
        sourceType: MovementSource.OPENING,
        // Stable per product, so re-running is idempotent.
        sourceId: `${storeId}:${p.id}`,
        actorId: actorId ?? null,
        occurredAt,
      })),
    );

    return { seeded: products.length, enabled: this.stockMovements.enabled };
  }

  /**
   * `periodStart` defaults to the last finalized stocktake, which is also the anchor the
   * arithmetic recomputes forward from — so the default period and the default anchor agree.
   */
  async goods(
    storeId: string,
    opts: { periodStart?: Date; periodEnd?: Date; countId?: string } = {},
  ): Promise<GoodsReconciliation> {
    const periodEnd = opts.periodEnd ?? new Date();

    // Physical counts come from a finalized stocktake — the only source of counted reality.
    const count = opts.countId
      ? await this.prisma.inventoryCount.findFirst({
          where: { id: opts.countId, storeId, status: 'COMPLETED' },
          include: { items: true },
        })
      : await this.prisma.inventoryCount.findFirst({
          where: { storeId, status: 'COMPLETED', completedAt: { lte: periodEnd } },
          orderBy: { completedAt: 'desc' },
          include: { items: true },
        });

    const countedByProduct = new Map<number, Prisma.Decimal>();
    for (const item of count?.items ?? []) {
      if (item.countedQty !== null) countedByProduct.set(item.productId, item.countedQty);
    }

    const products = await this.prisma.product.findMany({
      where: { storeId, active: true },
      select: { id: true, nameRu: true, barcode: true, unit: true, stock: true },
    });

    const movements = await this.prisma.stockMovement.findMany({
      where: { storeId, occurredAt: { lte: periodEnd } },
      orderBy: { occurredAt: 'asc' },
      select: {
        productId: true,
        type: true,
        quantity: true,
        balanceAfter: true,
        appliedToStock: true,
        occurredAt: true,
        unitCost: true,
        unitPrice: true,
      },
    });

    const byProduct = new Map<number, LedgerRow[]>();
    for (const m of movements) {
      const list = byProduct.get(m.productId);
      if (list) list.push(m);
      else byProduct.set(m.productId, [m]);
    }

    const lines: GoodsReconciliation['lines'] = [];
    const perpetual = new Map<number, Prisma.Decimal>();
    const recomputed = new Map<number, Prisma.Decimal>();
    let varianceCost = ZERO;
    let varianceRetail = ZERO;
    let shortageQtyLines = 0;
    let surplusQtyLines = 0;

    // Variance is measured AT the stocktake, not at the end of the period. The count states
    // what was physically on the shelf at one instant; the only meaningful question is what the
    // book said at that same instant. Measuring at periodEnd would compare a count taken on the
    // 20th against a book that has since absorbed ten more days of trading.
    //
    // `exclusiveEnd` stops the reconstruction just short of the count's own movements —
    // otherwise it would anchor on the count being judged and the variance would always be
    // zero (or exactly the sales that followed it).
    const measureAt = count?.completedAt ?? periodEnd;
    const exclusive = count != null;

    for (const p of products) {
      const rows = byProduct.get(p.id) ?? [];
      const v = computeVariance(
        p.id,
        rows,
        countedByProduct.get(p.id) ?? null,
        measureAt,
        exclusive,
      );

      // The cross-check runs to NOW, not to periodEnd: it asks "does the ledger still describe
      // today's stock?", which is a different question from "what moved during the period".
      perpetual.set(p.id, p.stock);
      recomputed.set(p.id, computeBookQty(rows, new Date()).bookQty);

      if (v.varianceQty) {
        if (v.varianceQty.gt(0)) shortageQtyLines++;
        else if (v.varianceQty.lt(0)) surplusQtyLines++;
        if (v.varianceCost) varianceCost = varianceCost.plus(v.varianceCost);
        if (v.varianceRetail) varianceRetail = varianceRetail.plus(v.varianceRetail);
      }

      lines.push({ ...v, productName: p.nameRu, barcode: p.barcode, unit: p.unit });
    }

    const nameById = new Map(products.map((p) => [p.id, p]));
    const driftRows = crossCheck(perpetual, recomputed).map((r) => ({
      ...r,
      productName: nameById.get(r.productId)?.nameRu ?? String(r.productId),
      barcode: nameById.get(r.productId)?.barcode ?? '',
    }));

    return {
      periodStart: opts.periodStart ?? count?.completedAt ?? null,
      periodEnd,
      countId: count?.id ?? null,
      lines: lines.filter((l) => l.varianceQty !== null || !l.bookQty.isZero()),
      totals: { shortageQtyLines, surplusQtyLines, varianceCost, varianceRetail },
      crossCheck: { clean: driftRows.length === 0, rows: driftRows },
      ledgerEnabled: this.stockMovements.enabled,
    };
  }
}
