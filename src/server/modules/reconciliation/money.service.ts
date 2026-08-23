import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const ZERO = new Prisma.Decimal(0);

export interface MoneyReconciliation {
  periodStart: Date;
  periodEnd: Date;
  /** Net of discount, split by tender. */
  byTender: { tender: string; amount: Prisma.Decimal; saleCount: number }[];
  gross: Prisma.Decimal;
  discounts: Prisma.Decimal;
  netSales: Prisma.Decimal;
  newDebts: Prisma.Decimal;
  expectedCollected: Prisma.Decimal;
  /**
   * Null until shift data reaches the server. Presented as null rather than 0 so the UI can say
   * "not available" instead of implying a perfect reconciliation that was never computed.
   */
  actuallyCollected: Prisma.Decimal | null;
  cashVariance: Prisma.Decimal | null;
  /** Why the variance is null, for the UI to render honestly. */
  limitation: string | null;
}

/**
 * Money reconciliation — deliberately separate from goods, and never netted against it.
 *
 * A credit sale removes goods exactly like a cash sale, so a debt is already inside "sales" in
 * the goods equation; it must not be subtracted there. Debt only explains why the drawer is
 * smaller than sales, which is this module's job alone.
 *
 * STAGE A (today): the expected side only. `Smena`/`SmenaMovement` hold `initialCash` and
 * `finalCash` — the actual drawer count — but they exist only in the terminal's SQLite and
 * have no sync path, so the server has nothing to compare against. Stage B adds that sync and
 * fills in `actuallyCollected`; the shape below already has the slot, so nothing restructures.
 */
@Injectable()
export class MoneyReconciliationService {
  constructor(private prisma: PrismaService) {}

  async reconcile(
    storeId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<MoneyReconciliation> {
    const grouped = await this.prisma.sale.groupBy({
      by: ['paymentMethod'],
      where: { storeId, createdAt: { gte: periodStart, lte: periodEnd } },
      _sum: { finalAmount: true, totalAmount: true, discountAmount: true },
      _count: { _all: true },
    });

    let gross = ZERO;
    let discounts = ZERO;
    let netSales = ZERO;

    const byTender = grouped.map((g) => {
      const amount = g._sum.finalAmount ?? ZERO;
      gross = gross.plus(g._sum.totalAmount ?? ZERO);
      discounts = discounts.plus(g._sum.discountAmount ?? ZERO);
      netSales = netSales.plus(amount);
      return { tender: g.paymentMethod, amount, saleCount: g._count._all };
    });

    // Debts are not tracked yet. Kept as an explicit term rather than omitted so the formula
    // below is already the final one — the nasiya feature only has to make this non-zero.
    const newDebts = ZERO;

    // finalAmount is ALREADY net of discountAmount (finalAmount = totalAmount − discountAmount),
    // so discounts must not be subtracted a second time here. They are reported for context only.
    const expectedCollected = netSales.minus(newDebts);

    return {
      periodStart,
      periodEnd,
      byTender: byTender.sort((a, b) => b.amount.comparedTo(a.amount)),
      gross,
      discounts,
      netSales,
      newDebts,
      expectedCollected,
      actuallyCollected: null,
      cashVariance: null,
      limitation: 'NO_SHIFT_DATA_ON_SERVER',
    };
  }
}
