import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Sale, SaleItem } from '@prisma/client';
import { rankProducts, type ProductPerformanceRow } from './analytics.ranking';

type SaleWithItems = Sale & { items: SaleItem[] };

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getDailyAnalytics(storeId: string, date: Date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const sales = await this.prisma.sale.findMany({
      where: {
        storeId,
        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      include: { items: true },
    });

    const totalSales = sales.length;
    const totalRevenue = sales.reduce(
      (sum: number, sale: SaleWithItems) => sum + Number(sale.finalAmount),
      0,
    );

    // Sales by cashier
    const salesByCashier = sales.reduce(
      (acc: Record<string, { count: number; revenue: number }>, sale: SaleWithItems) => {
        if (!acc[sale.cashierName]) {
          acc[sale.cashierName] = { count: 0, revenue: 0 };
        }
        acc[sale.cashierName].count++;
        acc[sale.cashierName].revenue += Number(sale.finalAmount);
        return acc;
      },
      {},
    );

    // Sales by hour
    const salesByHour = sales.reduce(
      (acc: Record<number, { count: number; revenue: number }>, sale: SaleWithItems) => {
        const hour = new Date(new Date(sale.createdAt).getTime() + 5 * 60 * 60 * 1000).getUTCHours();
        if (!acc[hour]) {
          acc[hour] = { count: 0, revenue: 0 };
        }
        acc[hour].count++;
        acc[hour].revenue += Number(sale.finalAmount);
        return acc;
      },
      {},
    );

    // Top products
    const productSales: Record<number, { name: string; quantity: number; revenue: number }> = {};
    for (const sale of sales) {
      for (const item of sale.items) {
        if (item.productId == null) continue;
        if (!productSales[item.productId]) {
          productSales[item.productId] = { name: item.productName, quantity: 0, revenue: 0 };
        }
        productSales[item.productId].quantity += Number(item.quantity);
        productSales[item.productId].revenue += Number(item.subtotal);
      }
    }

    const topProducts = Object.values(productSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    return {
      date: startOfDay.toISOString().split('T')[0],
      totalSales,
      totalRevenue,
      transactionCount: totalSales,
      averageTransaction: totalSales > 0 ? totalRevenue / totalSales : 0,
      topProducts,
      salesByCashier,
      salesByHour,
    };
  }

  async getMonthlyAnalytics(storeId: string, year: number, month: number) {
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);

    const sales = await this.prisma.sale.findMany({
      where: {
        storeId,
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      include: { items: true },
    });

    const totalSales = sales.length;
    const totalRevenue = sales.reduce(
      (sum: number, sale: SaleWithItems) => sum + Number(sale.finalAmount),
      0,
    );

    // Sales by day
    const salesByDay = sales.reduce(
      (acc: Record<number, { count: number; revenue: number }>, sale: SaleWithItems) => {
        const day = new Date(sale.createdAt).getDate();
        if (!acc[day]) {
          acc[day] = { count: 0, revenue: 0 };
        }
        acc[day].count++;
        acc[day].revenue += Number(sale.finalAmount);
        return acc;
      },
      {},
    );

    return {
      year,
      month,
      totalSales,
      totalRevenue,
      averageDaily: totalRevenue / endOfMonth.getDate(),
      salesByDay,
    };
  }

  async getAnalyticsData(storeId: string, startDate: Date, endDate: Date) {
    const [
      salesTrendRaw,
      salesByCategoryRaw,
      hourlyDistributionRaw,
      topProductsRaw,
      cashierPerformanceRaw,
      profitMarginsRaw,
      summaryRaw,
      productPerformanceRaw,
    ] = await Promise.all([
      this.prisma.$queryRaw<{ date: string; revenue: number; count: number }[]>`
        SELECT
          DATE(created_at)::text AS date,
          SUM(final_amount)::float AS revenue,
          COUNT(*)::int AS count
        FROM sales
        WHERE store_id = ${storeId}
          AND created_at >= ${startDate}
          AND created_at <= ${endDate}
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at)
      `,
      this.prisma.$queryRaw<{ categoryRu: string; categoryUz: string; revenue: number; quantity: number }[]>`
        SELECT
          COALESCE(c.name_ru, 'Без категории') AS "categoryRu",
          COALESCE(c.name_uz, 'Kategoriyasiz') AS "categoryUz",
          SUM(si.subtotal)::float AS revenue,
          SUM(si.quantity * si.pieces_per_unit)::float AS quantity
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        JOIN products p ON si.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE s.store_id = ${storeId}
          AND s.created_at >= ${startDate}
          AND s.created_at <= ${endDate}
        GROUP BY c.name_ru, c.name_uz
        ORDER BY revenue DESC
      `,
      this.prisma.$queryRaw<{ hour: number; revenue: number; count: number }[]>`
        SELECT
          EXTRACT(HOUR FROM created_at + INTERVAL '5 hours')::int AS hour,
          SUM(final_amount)::float AS revenue,
          COUNT(*)::int AS count
        FROM sales
        WHERE store_id = ${storeId}
          AND created_at >= ${startDate}
          AND created_at <= ${endDate}
        GROUP BY EXTRACT(HOUR FROM created_at + INTERVAL '5 hours')
        ORDER BY hour
      `,
      this.prisma.$queryRaw<{ name: string; quantity: number; revenue: number }[]>`
        SELECT
          si.product_name AS name,
          SUM(si.quantity * si.pieces_per_unit)::float AS quantity,
          SUM(si.subtotal)::float AS revenue
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE s.store_id = ${storeId}
          AND s.created_at >= ${startDate}
          AND s.created_at <= ${endDate}
        GROUP BY si.product_id, si.product_name
        ORDER BY revenue DESC
        LIMIT 10
      `,
      this.prisma.$queryRaw<{ name: string; revenue: number; count: number }[]>`
        SELECT
          cashier_name AS name,
          SUM(final_amount)::float AS revenue,
          COUNT(*)::int AS count
        FROM sales
        WHERE store_id = ${storeId}
          AND created_at >= ${startDate}
          AND created_at <= ${endDate}
        GROUP BY cashier_name
        ORDER BY revenue DESC
      `,
      this.prisma.$queryRaw<{ categoryRu: string; categoryUz: string; revenue: number; cost: number }[]>`
        SELECT
          COALESCE(c.name_ru, 'Без категории') AS "categoryRu",
          COALESCE(c.name_uz, 'Kategoriyasiz') AS "categoryUz",
          SUM(si.subtotal)::float AS revenue,
          SUM(si.quantity * si.pieces_per_unit * COALESCE(p.cost, 0))::float AS cost
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        JOIN products p ON si.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE s.store_id = ${storeId}
          AND s.created_at >= ${startDate}
          AND s.created_at <= ${endDate}
        GROUP BY c.name_ru, c.name_uz
        ORDER BY revenue DESC
      `,
      this.prisma.$queryRaw<{
        totalSales: number;
        totalRevenue: number;
        cashSales: number;
        cardSales: number;
        averageTransaction: number;
      }[]>`
        SELECT
          COUNT(*)::int AS "totalSales",
          SUM(final_amount)::float AS "totalRevenue",
          COUNT(*) FILTER (WHERE LOWER(payment_method) = 'cash')::int AS "cashSales",
          COUNT(*) FILTER (WHERE LOWER(payment_method) = 'card')::int AS "cardSales",
          CASE WHEN COUNT(*) > 0 THEN (SUM(final_amount) / COUNT(*))::float ELSE 0 END AS "averageTransaction"
        FROM sales
        WHERE store_id = ${storeId}
          AND created_at >= ${startDate}
          AND created_at <= ${endDate}
      `,
      // Drives the top/bottom-10 rankings. Starts from `products`, not `sale_items`, so a
      // product that sold NOTHING in the period still appears — with zeros — and can rank as a
      // worst seller. Aggregating from sale_items would make dead stock invisible, which is
      // precisely the thing a worst-sellers list exists to surface.
      //
      // The period filter lives inside the subquery, not in the outer WHERE: applied outside it
      // would silently turn the LEFT JOIN back into an inner join and drop every zero row.
      //
      // Cost is today's Product.cost, because SaleItem carries no cost snapshot. A product
      // re-priced mid-period is therefore valued at its latest cost — acceptable for a ranking,
      // but it is why reconciliation values variance from the ledger instead.
      this.prisma.$queryRaw<ProductPerformanceRow[]>`
        SELECT
          p.id AS "productId",
          p.name_ru AS "nameRu",
          p.name_uz AS "nameUz",
          COALESCE(agg.quantity, 0)::float AS quantity,
          COALESCE(agg.revenue, 0)::float AS revenue,
          (COALESCE(agg.quantity, 0) * COALESCE(p.cost, 0))::float AS cost,
          (p.cost IS NOT NULL) AS "hasCost"
        FROM products p
        LEFT JOIN (
          SELECT
            si.product_id,
            SUM(si.quantity * si.pieces_per_unit) AS quantity,
            SUM(si.subtotal) AS revenue
          FROM sale_items si
          JOIN sales s ON si.sale_id = s.id
          WHERE s.store_id = ${storeId}
            AND s.created_at >= ${startDate}
            AND s.created_at <= ${endDate}
          GROUP BY si.product_id
        ) agg ON agg.product_id = p.id
        WHERE p.store_id = ${storeId}
          AND p.active = true
      `,
    ]);

    return {
      salesTrend: salesTrendRaw,
      salesByCategory: salesByCategoryRaw,
      hourlyDistribution: hourlyDistributionRaw,
      // Kept as-is: the Electron renderer's own Analytics page still reads this shape.
      topProducts: topProductsRaw,
      productRanking: rankProducts(productPerformanceRaw),
      cashierPerformance: cashierPerformanceRaw,
      profitMargins: profitMarginsRaw,
      summary: summaryRaw[0] ?? {
        totalSales: 0,
        totalRevenue: 0,
        cashSales: 0,
        cardSales: 0,
        averageTransaction: 0,
      },
    };
  }

  async getProductPerformance(storeId: string, startDate: Date, endDate: Date) {
    const sales = await this.prisma.sale.findMany({
      where: {
        storeId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: { items: { include: { product: true } } },
    });

    const productStats: Record<
      number,
      { id: number; name: string; quantity: number; revenue: number; salesCount: number }
    > = {};

    for (const sale of sales) {
      for (const item of sale.items) {
        if (item.productId == null) continue;
        if (!productStats[item.productId]) {
          productStats[item.productId] = {
            id: item.productId,
            name: item.productName,
            quantity: 0,
            revenue: 0,
            salesCount: 0,
          };
        }
        productStats[item.productId].quantity += Number(item.quantity);
        productStats[item.productId].revenue += Number(item.subtotal);
        productStats[item.productId].salesCount++;
      }
    }

    return Object.values(productStats).sort((a, b) => b.revenue - a.revenue);
  }
}
