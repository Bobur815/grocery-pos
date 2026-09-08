import { dateParam, db, endOfDayParam, isAdmin } from '../helpers';
import { forbidden, notFound, type Route } from '../router';

/**
 * Sales.
 *
 * Read and delete only — creating a sale is the till's job, and the dashboard has never had a
 * route for it either (the server's `POST /sales/sync` is the terminal's upload path, not a
 * dashboard endpoint). The daily and monthly reports work by pulling `GET /sales` for a date
 * range and aggregating in the browser, so the range query is the one that has to be right.
 */

const USER_SELECT = { items: true } as const;

export const salesRoutes: Route[] = [
  {
    method: 'GET',
    path: '/sales',
    handler: async ({ query, user }) => {
      const startDate = dateParam(query.startDate, 'startDate');
      const endDate = endOfDayParam(query.endDate, 'endDate');
      const hasRange = Boolean(startDate || endDate);

      // A cashier only ever sees their own receipts; an admin sees everyone's and may filter.
      const cashierId = isAdmin(user?.role) ? query.cashierId || undefined : user!.id;

      return db().sale.findMany({
        where: {
          ...(cashierId ? { cashierId } : {}),
          ...(hasRange
            ? {
                createdAt: {
                  ...(startDate ? { gte: startDate } : {}),
                  ...(endDate ? { lte: endDate } : {}),
                },
              }
            : {}),
          ...(query.terminalId ? { terminalId: query.terminalId } : {}),
        },
        include: USER_SELECT,
        orderBy: { createdAt: 'desc' },
        // Unbounded for an explicit range — the reports need every receipt in the period to add
        // up — but capped for the bare list, which is only ever the recent-activity view.
        ...(hasRange ? {} : { take: 100 }),
      });
    },
  },

  {
    method: 'GET',
    path: '/sales/today/summary',
    handler: async ({ user }) => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);

      const sales = await db().sale.findMany({
        where: {
          createdAt: { gte: start },
          ...(isAdmin(user?.role) ? {} : { cashierId: user!.id }),
        },
        include: { items: true },
      });

      const total = (predicate: (method: string) => boolean) =>
        sales
          .filter((s) => predicate((s.paymentMethod ?? '').toLowerCase()))
          .reduce((sum, s) => sum + Number(s.finalAmount), 0);

      const totalRevenue = sales.reduce((sum, s) => sum + Number(s.finalAmount), 0);

      return {
        date: start.toISOString(),
        totalSales: sales.length,
        totalRevenue,
        totalItems: sales.reduce(
          (sum, s) => sum + s.items.reduce((n, i) => n + Number(i.quantity), 0),
          0,
        ),
        cashSales: total((m) => m === 'cash'),
        cardSales: total((m) => m === 'card'),
        uzqrSales: total((m) => m === 'uzqr'),
        averageTransaction: sales.length > 0 ? totalRevenue / sales.length : 0,
      };
    },
  },

  {
    method: 'GET',
    path: '/sales/:id',
    handler: async ({ params, user }) => {
      const sale = await db().sale.findUnique({
        where: { id: params.id },
        include: USER_SELECT,
      });
      if (!sale) throw notFound('Sale not found');
      if (!isAdmin(user?.role) && sale.cashierId !== user!.id) throw forbidden();
      return sale;
    },
  },

  {
    method: 'DELETE',
    path: '/sales/:id',
    roles: ['ADMIN', 'SUPER_ADMIN'],
    handler: async ({ params }) => {
      const sale = await db().sale.findUnique({
        where: { id: params.id },
        include: { items: true },
      });
      if (!sale) throw notFound('Sale not found');

      // Deleting a receipt puts its goods back on the shelf — otherwise the stock figure silently
      // drifts down by the amount of every cancelled sale.
      await db().$transaction(async (tx) => {
        for (const item of sale.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: Number(item.quantity) } },
          });
        }
        await tx.saleItem.deleteMany({ where: { saleId: sale.id } });
        await tx.sale.delete({ where: { id: sale.id } });
      });

      return { deleted: true };
    },
  },
];
