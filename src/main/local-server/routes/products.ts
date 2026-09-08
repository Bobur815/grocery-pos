import { boolParam, db, dateParam, intParam, isAdmin, required } from '../helpers';
import { badRequest, forbidden, notFound, type Route } from '../router';

/**
 * Products.
 *
 * Deliberately NOT built on `products:getAll` and friends in `../../ipc/products-handlers.ts`.
 * Those run `serializeProduct()`, which renames `active` to `isActive`, turns Decimals into
 * numbers and drops null fields — the POS renderer's own convention. The dashboard was written
 * against the server's raw Prisma rows, so that is what this returns.
 */

const withRelations = { category: true, supplier: true } as const;

export const productRoutes: Route[] = [
  {
    method: 'GET',
    path: '/products',
    handler: async ({ query }) => {
      const categoryId = intParam(query.categoryId);
      const active = boolParam(query.active);
      const updatedAfter = dateParam(query.updatedAfter, 'updatedAfter');

      // `query` is not a server filter — there, search is done in the browser over the full list.
      // Honouring it here narrows the same result set rather than changing it, and saves a
      // phone on shop Wi-Fi from pulling every product to filter locally.
      const search = query.query?.trim();

      return db().product.findMany({
        where: {
          ...(categoryId !== undefined ? { categoryId } : {}),
          ...(active !== undefined ? { active } : {}),
          ...(updatedAfter ? { updatedAt: { gt: updatedAfter } } : {}),
          ...(search
            ? {
                OR: [
                  { nameRu: { contains: search } },
                  { nameUz: { contains: search } },
                  { barcode: { contains: search } },
                ],
              }
            : {}),
        },
        include: withRelations,
        orderBy: { createdAt: 'desc' },
      });
    },
  },

  {
    method: 'GET',
    path: '/products/next-internal-code',
    handler: async () => {
      // Five digits, first free from 10000 — same rule as products:getNextInternalCode, so a
      // label printed from the phone cannot collide with one printed at the till.
      const used = await db().product.findMany({
        where: { internalCode: { not: null } },
        select: { internalCode: true },
      });
      const taken = new Set(used.map((p) => p.internalCode));
      for (let code = 10000; code <= 99999; code++) {
        const candidate = String(code);
        if (!taken.has(candidate)) return candidate;
      }
      throw badRequest('No internal codes left');
    },
  },

  {
    method: 'GET',
    path: '/products/top-selling',
    handler: async ({ query }) => {
      const limit = intParam(query.limit) ?? 10;
      const grouped = await db().saleItem.groupBy({
        by: ['productId'],
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: limit,
      });
      const products = await db().product.findMany({
        where: { id: { in: grouped.map((g) => g.productId) } },
        include: withRelations,
      });
      // groupBy returns the ranking; findMany does not preserve it.
      const order = new Map(grouped.map((g, index) => [g.productId, index]));
      return products.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    },
  },

  {
    method: 'GET',
    path: '/products/barcode/:barcode',
    handler: async ({ params }) => {
      const byPiece = await db().product.findUnique({
        where: { barcode: params.barcode },
        include: withRelations,
      });
      if (byPiece) return byPiece;
      // A boxed product carries a second barcode for the sealed pack.
      const byBox = await db().product.findUnique({
        where: { boxBarcode: params.barcode },
        include: withRelations,
      });
      if (!byBox) throw notFound('Product not found');
      return byBox;
    },
  },

  {
    method: 'GET',
    path: '/products/internal-code/:code',
    handler: async ({ params }) => {
      const raw = params.code.trim();
      // Scales pad the code to six digits; both forms must resolve to the same product.
      const candidates = [raw, raw.padStart(6, '0'), raw.replace(/^0+/, '')];
      const product = await db().product.findFirst({
        where: { internalCode: { in: candidates } },
        include: withRelations,
      });
      if (!product) throw notFound('Product not found');
      return product;
    },
  },

  {
    method: 'GET',
    path: '/products/:id/analytics',
    handler: async ({ params, query }) => {
      const productId = intParam(params.id);
      if (productId === undefined) throw badRequest('Invalid product id');

      const product = await db().product.findUnique({ where: { id: productId } });
      if (!product) throw notFound('Product not found');

      const endDate = query.endDate ? new Date(query.endDate) : new Date();
      const startDate = query.startDate
        ? new Date(query.startDate)
        : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

      const items = await db().saleItem.findMany({
        where: { productId, sale: { createdAt: { gte: startDate, lte: endDate } } },
        include: { sale: { select: { id: true } } },
      });

      const totalUnitsSold = items.reduce((sum, i) => sum + Number(i.quantity), 0);
      const totalRevenue = items.reduce((sum, i) => sum + Number(i.subtotal), 0);
      const cost = product.cost ? Number(product.cost) : 0;
      const totalCost = totalUnitsSold * cost;
      const days = Math.max(
        1,
        Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)),
      );

      return {
        productId,
        period: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          days,
        },
        sales: {
          totalUnitsSold,
          totalRevenue,
          totalCost,
          profit: totalRevenue - totalCost,
          profitMargin: totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0,
          avgDailySales: totalUnitsSold / days,
          transactionCount: new Set(items.map((i) => i.sale.id)).size,
        },
        inventory: {
          currentStock: Number(product.stock),
          cost,
          inventoryValue: Number(product.stock) * cost,
        },
      };
    },
  },

  {
    method: 'GET',
    path: '/products/:id',
    handler: async ({ params, query }) => {
      const product = await findProduct(params.id, query.byDbId === 'true');
      if (!product) throw notFound('Product not found');
      return product;
    },
  },

  {
    method: 'POST',
    path: '/products',
    roles: ['ADMIN', 'SUPER_ADMIN'],
    handler: async ({ body }) => {
      required(body?.barcode, 'barcode');
      required(body?.nameRu, 'nameRu');
      required(body?.nameUz, 'nameUz');
      // Fiscalisation needs the MXIK code, and a product created without one cannot be sold on a
      // receipt — so it is refused here rather than failing at the till later.
      required(body?.mxik, 'mxik');

      return db().product.create({
        data: buildProductData(body, true),
        include: withRelations,
      });
    },
  },

  {
    method: 'PATCH',
    path: '/products/:id',
    roles: ['ADMIN', 'SUPER_ADMIN'],
    handler: async ({ params, body }) => {
      const existing = await findProduct(params.id, true);
      if (!existing) throw notFound('Product not found');
      return db().product.update({
        where: { id: existing.id },
        data: buildProductData(body, false),
        include: withRelations,
      });
    },
  },

  {
    method: 'DELETE',
    path: '/products/:id',
    roles: ['ADMIN', 'SUPER_ADMIN'],
    handler: async ({ params, user }) => {
      if (!isAdmin(user?.role)) throw forbidden();
      const existing = await findProduct(params.id, true);
      if (!existing) throw notFound('Product not found');

      // A product is referenced by past receipts, so it cannot simply be deleted. Same cascade
      // the server performs: drop its sale lines, then any receipt left with no lines at all.
      await db().$transaction(async (tx) => {
        const items = await tx.saleItem.findMany({
          where: { productId: existing.id },
          select: { saleId: true },
        });
        const saleIds = [...new Set(items.map((i) => i.saleId))];
        await tx.saleItem.deleteMany({ where: { productId: existing.id } });
        await tx.inventoryArrival.deleteMany({ where: { productId: existing.id } });
        for (const saleId of saleIds) {
          const remaining = await tx.saleItem.count({ where: { saleId } });
          if (remaining === 0) await tx.sale.delete({ where: { id: saleId } });
        }
        await tx.product.delete({ where: { id: existing.id } });
      });

      return { success: true };
    },
  },
];

/**
 * Resolve the `:id` segment.
 *
 * The dashboard addresses a product either by its database id or by the shopkeeper-facing
 * `storeProductCode`, which is what is printed on shelf labels. `byDbId` says which.
 */
async function findProduct(id: string, byDbId: boolean) {
  const numeric = Number(id);
  if (!Number.isFinite(numeric)) return null;

  if (!byDbId) {
    const byCode = await db().product.findFirst({
      where: { storeProductCode: Math.trunc(numeric) },
      include: withRelations,
    });
    if (byCode) return byCode;
  }
  return db().product.findUnique({
    where: { id: Math.trunc(numeric) },
    include: withRelations,
  });
}

/** Whitelist of writable columns — a request must not be able to set `id` or `createdAt`. */
function buildProductData(body: any, isCreate: boolean): any {
  const data: any = {};
  const copy = (key: string) => {
    if (body?.[key] !== undefined) data[key] = body[key];
  };

  [
    'barcode', 'nameRu', 'nameUz', 'unit', 'mxik', 'packageCode', 'internalCode',
    'productType', 'boxBarcode', 'active', 'isOnPromotion', 'isMarked',
  ].forEach(copy);

  [
    'price', 'cost', 'stock', 'minStock', 'discountPercent', 'pendingPrice',
    'pendingPriceThreshold', 'bulkQuantity', 'minSaleQty', 'maxSaleQty', 'boxPrice',
  ].forEach((key) => {
    if (body?.[key] !== undefined && body[key] !== null) data[key] = Number(body[key]);
    else if (body?.[key] === null) data[key] = null;
  });

  ['categoryId', 'piecesPerBox', 'storeProductCode', 'vatRate'].forEach((key) => {
    if (body?.[key] !== undefined && body[key] !== null) data[key] = Math.trunc(Number(body[key]));
    else if (body?.[key] === null) data[key] = null;
  });

  if (body?.supplierId !== undefined) data.supplierId = body.supplierId || null;
  ['productionDate', 'expiryDate'].forEach((key) => {
    if (body?.[key] !== undefined) data[key] = body[key] ? new Date(body[key]) : null;
  });

  if (isCreate) {
    data.price ??= 0;
    data.stock ??= 0;
    data.minStock ??= 0;
    data.active ??= true;
  }
  return data;
}
