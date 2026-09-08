import { rankProducts, type ProductPerformanceRow } from '../../../server/modules/analytics/analytics.ranking';
import { db, dateParam, endOfDayParam } from '../helpers';
import type { Route } from '../router';

/**
 * The analytics page.
 *
 * A direct port of `AnalyticsService.getAnalyticsData()` — the same seven queries, translated
 * from PostgreSQL to the SQLite dialect. The Electron `analytics:getData` IPC handler runs
 * something similar for the POS's own analytics screen, but it is not a faithful copy of this
 * endpoint (no `productRanking`, `topProducts` sorted by quantity instead of revenue, and a
 * `LIMIT 10` on the category breakdowns), so it is not reused here.
 *
 * `rankProducts()` is imported from the server module rather than reimplemented: it is pure,
 * already unit-tested, and the ordering rules around missing cost prices are subtle enough that
 * a second copy would drift.
 *
 * Timezone: the server buckets hours at a hardcoded UTC+5 and days at plain UTC — inconsistent
 * with itself. Here both use the terminal's own local time, which for a shop in Uzbekistan is
 * UTC+5 with no DST. That makes the day and hour buckets agree with each other and with the
 * till's own reports, which is what the shopkeeper is comparing against.
 */

interface TrendRow {
  date: string;
  revenue: number;
  count: number;
}

/**
 * Coerce the numbers out of a raw SQLite result.
 *
 * Prisma hands back a `BigInt` for an INTEGER-affinity column, and `JSON.stringify` throws on
 * one — so a single `COUNT(*)` would turn the whole analytics response into a 500. Nulls from
 * `SUM()` over an empty period become 0, which is what the charts expect to plot.
 */
function numeric<T extends object>(rows: T[], fields: (keyof T)[]): T[] {
  return rows.map((row) => {
    const copy = { ...row };
    for (const field of fields) {
      copy[field] = Number(copy[field] ?? 0) as T[keyof T];
    }
    return copy;
  });
}

export const analyticsRoutes: Route[] = [
  {
    method: 'GET',
    path: '/analytics/data',
    handler: async ({ query }) => {
      const startDate = dateParam(query.startDate, 'startDate') ?? new Date(0);
      const endDate = endOfDayParam(query.endDate, 'endDate') ?? new Date();

      // SQLite stores DateTime as epoch milliseconds; the raw queries below compare against
      // these numbers directly rather than relying on driver-side date binding.
      const from = startDate.getTime();
      const to = endDate.getTime();

      const prisma = db();
      const [
        salesTrend,
        salesByCategory,
        hourlyDistribution,
        topProducts,
        cashierPerformance,
        profitMargins,
        summaryRows,
        productPerformance,
      ] = await Promise.all([
        prisma.$queryRaw<TrendRow[]>`
          SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS date,
                 CAST(SUM(final_amount) AS REAL) AS revenue,
                 CAST(COUNT(*) AS INTEGER) AS count
          FROM sales
          WHERE created_at >= ${from} AND created_at <= ${to}
          GROUP BY date ORDER BY date
        `,

        prisma.$queryRaw<
          { categoryRu: string; categoryUz: string; revenue: number; quantity: number }[]
        >`
          SELECT COALESCE(c.name_ru, 'Без категории') AS categoryRu,
                 COALESCE(c.name_uz, 'Kategoriyasiz') AS categoryUz,
                 CAST(SUM(si.subtotal) AS REAL) AS revenue,
                 CAST(SUM(si.quantity * si.pieces_per_unit) AS REAL) AS quantity
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          JOIN products p ON si.product_id = p.id
          LEFT JOIN categories c ON p.category_id = c.id
          WHERE s.created_at >= ${from} AND s.created_at <= ${to}
          GROUP BY c.name_ru, c.name_uz
          ORDER BY revenue DESC
        `,

        prisma.$queryRaw<{ hour: number; revenue: number; count: number }[]>`
          SELECT CAST(strftime('%H', created_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
                 CAST(SUM(final_amount) AS REAL) AS revenue,
                 CAST(COUNT(*) AS INTEGER) AS count
          FROM sales
          WHERE created_at >= ${from} AND created_at <= ${to}
          GROUP BY hour ORDER BY hour
        `,

        // Ordered by revenue, matching the server. The POS's own handler orders by quantity,
        // which answers a different question and would give a different top ten.
        prisma.$queryRaw<{ name: string; quantity: number; revenue: number }[]>`
          SELECT si.product_name AS name,
                 CAST(SUM(si.quantity * si.pieces_per_unit) AS REAL) AS quantity,
                 CAST(SUM(si.subtotal) AS REAL) AS revenue
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE s.created_at >= ${from} AND s.created_at <= ${to}
          GROUP BY si.product_id, si.product_name
          ORDER BY revenue DESC
          LIMIT 10
        `,

        prisma.$queryRaw<{ name: string; revenue: number; count: number }[]>`
          SELECT cashier_name AS name,
                 CAST(SUM(final_amount) AS REAL) AS revenue,
                 CAST(COUNT(*) AS INTEGER) AS count
          FROM sales
          WHERE created_at >= ${from} AND created_at <= ${to}
          GROUP BY cashier_name
          ORDER BY revenue DESC
        `,

        prisma.$queryRaw<
          { categoryRu: string; categoryUz: string; revenue: number; cost: number }[]
        >`
          SELECT COALESCE(c.name_ru, 'Без категории') AS categoryRu,
                 COALESCE(c.name_uz, 'Kategoriyasiz') AS categoryUz,
                 CAST(SUM(si.subtotal) AS REAL) AS revenue,
                 CAST(SUM(si.quantity * si.pieces_per_unit * COALESCE(p.cost, 0)) AS REAL) AS cost
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          JOIN products p ON si.product_id = p.id
          LEFT JOIN categories c ON p.category_id = c.id
          WHERE s.created_at >= ${from} AND s.created_at <= ${to}
          GROUP BY c.name_ru, c.name_uz
          ORDER BY revenue DESC
        `,

        // LOWER() on the payment method, as the server does: a single 'Cash' row written by an
        // older build would otherwise silently count as neither cash nor card.
        prisma.$queryRaw<
          {
            totalSales: number;
            totalRevenue: number;
            cashSales: number;
            cardSales: number;
            averageTransaction: number;
          }[]
        >`
          SELECT CAST(COUNT(*) AS INTEGER) AS totalSales,
                 CAST(COALESCE(SUM(final_amount), 0) AS REAL) AS totalRevenue,
                 CAST(SUM(CASE WHEN LOWER(payment_method) = 'cash' THEN 1 ELSE 0 END) AS INTEGER) AS cashSales,
                 CAST(SUM(CASE WHEN LOWER(payment_method) = 'card' THEN 1 ELSE 0 END) AS INTEGER) AS cardSales,
                 CAST(CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(final_amount), 0) * 1.0 / COUNT(*) ELSE 0 END AS REAL) AS averageTransaction
          FROM sales
          WHERE created_at >= ${from} AND created_at <= ${to}
        `,

        // Starts from `products`, not `sale_items`, so a product that sold nothing still appears
        // with zeros and can rank as a worst seller. The period filter stays inside the subquery:
        // moving it to the outer WHERE would turn the LEFT JOIN back into an inner one and drop
        // exactly those rows.
        prisma.$queryRaw<Array<Omit<ProductPerformanceRow, 'hasCost'> & { hasCost: number }>>`
          SELECT p.id AS productId,
                 p.name_ru AS nameRu,
                 p.name_uz AS nameUz,
                 CAST(COALESCE(agg.quantity, 0) AS REAL) AS quantity,
                 CAST(COALESCE(agg.revenue, 0) AS REAL) AS revenue,
                 CAST(COALESCE(agg.quantity, 0) * COALESCE(p.cost, 0) AS REAL) AS cost,
                 (p.cost IS NOT NULL) AS hasCost
          FROM products p
          LEFT JOIN (
            SELECT si.product_id,
                   SUM(si.quantity * si.pieces_per_unit) AS quantity,
                   SUM(si.subtotal) AS revenue
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            WHERE s.created_at >= ${from} AND s.created_at <= ${to}
            GROUP BY si.product_id
          ) agg ON agg.product_id = p.id
          WHERE p.active = 1
        `,
      ]);

      return {
        salesTrend: numeric(salesTrend, ['revenue', 'count']),
        salesByCategory: numeric(salesByCategory, ['revenue', 'quantity']),
        hourlyDistribution: numeric(hourlyDistribution, ['hour', 'revenue', 'count']),
        topProducts: numeric(topProducts, ['quantity', 'revenue']),
        // SQLite has no boolean type, so the driver hands back 0/1 for `hasCost`.
        productRanking: rankProducts(
          numeric(productPerformance, ['productId', 'quantity', 'revenue', 'cost']).map((row) => ({
            ...row,
            hasCost: Boolean(row.hasCost),
          })),
        ),
        cashierPerformance: numeric(cashierPerformance, ['revenue', 'count']),
        profitMargins: numeric(profitMargins, ['revenue', 'cost']),
        summary: numeric(summaryRows, [
          'totalSales',
          'totalRevenue',
          'cashSales',
          'cardSales',
          'averageTransaction',
        ])[0] ?? {
          totalSales: 0,
          totalRevenue: 0,
          cashSales: 0,
          cardSales: 0,
          averageTransaction: 0,
        },
      };
    },
  },
];
