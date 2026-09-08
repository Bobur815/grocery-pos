import { getPrismaNamespace } from '../../database/sqlite-client';
import { db, dateParam, endOfDayParam } from '../helpers';
import type { Route } from '../router';

/**
 * Reconciliation.
 *
 * **Money** is served in full, and from better inputs than the server has. On the VPS the drawer
 * figures are pre-computed totals a terminal mirrors up at shift close, because a refund there is
 * a hard-deleted sale and the server cannot reconstruct the shift afterwards. Here the raw rows
 * are right in front of us, so cash taken, pay-ins, pay-outs and refunds are each derived from
 * the sales and movements of the shift itself.
 *
 * **Goods** is not. It is computed from a `StockMovement` ledger that does not exist in the
 * terminal's schema — and that is not merely an omission to fill in: the ledger is off by default
 * on the VPS too (`RECONCILIATION_LEDGER_ENABLED`), and the server's own empty-ledger path
 * produces nonsense, reporting every counted product as a surplus and every stocked product as
 * drifting. Reproducing that faithfully would mean shipping a screen full of false shortages, so
 * this returns the empty, honest form of the same shape with `ledgerEnabled: false` — the flag
 * the dashboard already reads to explain that the figures are unavailable.
 */



export const reconciliationRoutes: Route[] = [
  {
    method: 'GET',
    path: '/reconciliation/goods',
    roles: ['ADMIN', 'SUPER_ADMIN'],
    handler: ({ query }) => ({
      periodStart: dateParam(query.from, 'from')?.toISOString() ?? null,
      periodEnd: (endOfDayParam(query.to, 'to') ?? new Date()).toISOString(),
      countId: query.countId ?? null,
      lines: [],
      totals: {
        shortageQtyLines: 0,
        surplusQtyLines: 0,
        varianceCost: '0',
        varianceRetail: '0',
      },
      crossCheck: { clean: true, rows: [] },
      // The terminal keeps no movement ledger, so there is no book quantity to compare a count
      // against. Stocktake results themselves are complete — see /inventory-counts/:id.
      ledgerEnabled: false,
    }),
  },

  {
    method: 'POST',
    path: '/reconciliation/seed-opening',
    roles: ['ADMIN', 'SUPER_ADMIN'],
    handler: () => ({ seeded: 0, enabled: false }),
  },

  {
    method: 'GET',
    path: '/reconciliation/money',
    roles: ['ADMIN', 'SUPER_ADMIN'],
    handler: async ({ query }) => {
      // Fetched per request, not at module load: the generated client is required at runtime and
      // is not available until the database has been initialised.
      const { Decimal } = getPrismaNamespace();
      const ZERO = new Decimal(0);

      const periodStart = dateParam(query.from, 'from') ?? new Date(0);
      const periodEnd = endOfDayParam(query.to, 'to') ?? new Date();
      const period = { gte: periodStart, lte: periodEnd };

      const grouped = await db().sale.groupBy({
        by: ['paymentMethod'],
        where: { createdAt: period },
        _sum: { finalAmount: true, totalAmount: true, discountAmount: true },
        _count: { _all: true },
      });

      let gross = ZERO;
      let discounts = ZERO;
      let netSales = ZERO;
      const byTender = grouped.map((g) => {
        const amount = new Decimal(g._sum.finalAmount ?? 0);
        gross = gross.plus(new Decimal(g._sum.totalAmount ?? 0));
        discounts = discounts.plus(new Decimal(g._sum.discountAmount ?? 0));
        netSales = netSales.plus(amount);
        return { tender: g.paymentMethod, amount: amount.toString(), saleCount: g._count._all };
      });

      // Credit sales are not tracked yet. Kept as an explicit term rather than dropped so the
      // formula below is already the final one when they are.
      const newDebts = ZERO;
      // finalAmount is already net of discountAmount, so discounts must not come off a second
      // time — they are reported for context only.
      const expectedCollected = netSales.minus(newDebts);

      // A shift belongs to the period in which it was counted out: that instant is what its
      // finalCash describes. One opened before the period and closed inside it counts here.
      const shifts = await db().smena.findMany({
        where: { closedAt: period },
        include: { movements: true, sales: true },
      });

      let expectedCash = ZERO;
      let actualCash = ZERO;
      let shiftCount = 0;

      for (const shift of shifts) {
        // An open shift has no counted figure yet, so it cannot contribute a variance.
        if (shift.finalCash === null) continue;

        const movementTotal = (type: string) =>
          shift.movements
            .filter((m) => m.type === type)
            .reduce((sum, m) => sum.plus(new Decimal(m.amount)), ZERO);

        const cashSales = shift.sales
          .filter((s) => (s.paymentMethod ?? '').toLowerCase() === 'cash' && !s.refunded)
          .reduce((sum, s) => sum.plus(new Decimal(s.finalAmount)), ZERO);

        // Refunds leave the drawer, so they come off what it should hold. The server cannot do
        // this — it deletes refunded sales — but the terminal keeps the flag.
        const returns = shift.sales
          .filter((s) => s.refunded)
          .reduce((sum, s) => sum.plus(new Decimal(s.finalAmount)), ZERO);

        const expected = new Decimal(shift.initialCash)
          .plus(cashSales)
          .plus(movementTotal('PAY_IN'))
          .minus(movementTotal('PAY_OUT'))
          .minus(returns);

        expectedCash = expectedCash.plus(expected);
        actualCash = actualCash.plus(new Decimal(shift.finalCash));
        shiftCount++;
      }

      const counted = shiftCount > 0;
      return {
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        byTender: byTender.sort((a, b) => Number(b.amount) - Number(a.amount)),
        gross: gross.toString(),
        discounts: discounts.toString(),
        netSales: netSales.toString(),
        newDebts: newDebts.toString(),
        expectedCollected: expectedCollected.toString(),
        actuallyCollected: counted ? actualCash.toString() : null,
        cashVariance: counted ? actualCash.minus(expectedCash).toString() : null,
        // A period with no closed shift was never compared, which must not read as balanced.
        limitation: counted ? null : 'NO_SHIFT_DATA_ON_SERVER',
        drawer: {
          shiftCount,
          expectedCash: expectedCash.toString(),
          actualCash: counted ? actualCash.toString() : null,
        },
      };
    },
  },
];
