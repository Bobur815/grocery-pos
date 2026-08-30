import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { sumDrawers } from '../smena/smena.math';

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
   * Counted out of the drawer across the period's closed shifts. Still null when the period has
   * no shift data — presented as null rather than 0 so the UI can say "not available" instead
   * of implying a perfect reconciliation that was never computed.
   */
  actuallyCollected: Prisma.Decimal | null;
  cashVariance: Prisma.Decimal | null;
  /** Why the variance is null, for the UI to render honestly. */
  limitation: string | null;
  /** The drawer side of the reconciliation, reported apart from the sales side. */
  drawer: {
    shiftCount: number;
    /** opening float + cash sales + pay-ins − pay-outs − refunds, summed over closed shifts. */
    expectedCash: Prisma.Decimal;
    actualCash: Prisma.Decimal | null;
  };
}

/**
 * Money reconciliation — deliberately separate from goods, and never netted against it.
 *
 * A credit sale removes goods exactly like a cash sale, so a debt is already inside "sales" in
 * the goods equation; it must not be subtracted there. Debt only explains why the drawer is
 * smaller than sales, which is this module's job alone.
 *
 * The drawer side comes from `Smena` rows mirrored up by the terminals at shift close. Those
 * carry terminal-computed totals rather than figures recomputed here, because a return is a
 * hard-deleted Sale on this side — after one, the server can no longer reconstruct what a shift
 * actually took in. See the note on the `Smena` model.
 *
 * A period with no synced shifts still reports the expected side and says so via `limitation`,
 * rather than showing a zero variance that was never computed.
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

    // Bucketed by close time: a shift belongs to the period in which it was counted out, which
    // is the instant its `finalCash` describes. A shift opened before `periodStart` and closed
    // inside it is therefore included, correctly — its whole drawer was reconciled in-period.
    const shifts = await this.prisma.smena.findMany({
      where: { storeId, closedAt: { gte: periodStart, lte: periodEnd } },
      select: {
        initialCash: true,
        finalCash: true,
        cashSalesAmount: true,
        payInTotal: true,
        payOutTotal: true,
        returnAmount: true,
      },
    });

    const drawer = sumDrawers(shifts);

    return {
      periodStart,
      periodEnd,
      byTender: byTender.sort((a, b) => b.amount.comparedTo(a.amount)),
      gross,
      discounts,
      netSales,
      newDebts,
      expectedCollected,
      actuallyCollected: drawer.actualCash,
      cashVariance: drawer.variance,
      // Kept as a distinct signal from "variance is zero": no shifts reached the server for this
      // period, so nothing was compared. A terminal that never syncs must not read as balanced.
      limitation: drawer.shiftCount === 0 ? 'NO_SHIFT_DATA_ON_SERVER' : null,
      drawer: {
        shiftCount: drawer.shiftCount,
        expectedCash: drawer.expectedCash,
        actualCash: drawer.actualCash,
      },
    };
  }
}
