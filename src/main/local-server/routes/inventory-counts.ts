import { db, intParam } from '../helpers';
import { planCompletion, type WriteOffSelection } from '../stocktake-plan';
import { badRequest, notFound, type Route } from '../router';

/**
 * Inventarizatsiya — a stocktake run from the phone.
 *
 * The `inventory_counts` / `inventory_count_items` tables were added to the SQLite schema for
 * this; on the VPS they are web-only and never reached a terminal. Everything here is a port of
 * `InventoryCountService`, minus the stock-movement ledger it writes alongside (that ledger is
 * off by default even on the server — see the reconciliation route for why it is not reproduced).
 */

const ADMIN_ONLY = ['ADMIN', 'SUPER_ADMIN'];
const OPEN_STATUSES = ['DRAFT', 'IN_PROGRESS'];

const SUMMARY_FIELDS = {
  id: true,
  number: true,
  status: true,
  scope: true,
  note: true,
  createdByName: true,
  createdAt: true,
  completedAt: true,
  totalItems: true,
  countedItems: true,
  totalDifference: true,
  totalValueDiff: true,
  wroteOffUncounted: true,
  writtenOffItems: true,
  writeOffValue: true,
} as const;

export const inventoryCountRoutes: Route[] = [
  {
    method: 'GET',
    path: '/inventory-counts',
    roles: ADMIN_ONLY,
    handler: async ({ query }) => {
      const page = Math.max(1, intParam(query.page) ?? 1);
      const limit = Math.min(100, Math.max(1, intParam(query.limit) ?? 20));
      const search = query.search?.trim();
      const asNumber = search ? Number(search) : NaN;

      const where = {
        ...(query.status ? { status: query.status } : {}),
        ...(search
          ? {
              OR: [
                { note: { contains: search } },
                { createdByName: { contains: search } },
                ...(Number.isInteger(asNumber) ? [{ number: asNumber }] : []),
              ],
            }
          : {}),
      };

      const [rows, total] = await Promise.all([
        db().inventoryCount.findMany({
          where,
          select: SUMMARY_FIELDS,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        db().inventoryCount.count({ where }),
      ]);

      return { rows, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
    },
  },

  {
    method: 'POST',
    path: '/inventory-counts',
    roles: ADMIN_ONLY,
    handler: async ({ body, user }) => {
      const scope = body?.scope ?? 'FULL';
      if (scope === 'CUSTOM') throw badRequest('CUSTOM scope is not supported');
      if (!['FULL', 'CATEGORY'].includes(scope)) throw badRequest('Invalid scope');

      // One open document at a time. Two overlapping counts would each snapshot the same stock
      // and then both write an absolute figure back, so the second would silently undo the first.
      const open = await db().inventoryCount.findFirst({ where: { status: { in: OPEN_STATUSES } } });
      if (open) throw badRequest('Another stocktake is already in progress');

      const categoryId = intParam(body?.categoryId != null ? String(body.categoryId) : undefined);
      if (scope === 'CATEGORY') {
        if (categoryId === undefined) throw badRequest('categoryId is required for CATEGORY scope');
        if (!(await db().category.findUnique({ where: { id: categoryId } }))) {
          throw notFound('Category not found');
        }
      }

      const products = await db().product.findMany({
        where: { active: true, ...(scope === 'CATEGORY' ? { categoryId: categoryId! } : {}) },
        orderBy: { nameRu: 'asc' },
      });
      if (products.length === 0) throw badRequest('No products to count');

      const last = await db().inventoryCount.findFirst({ orderBy: { number: 'desc' } });

      const created = await db().inventoryCount.create({
        data: {
          number: (last?.number ?? 0) + 1,
          status: 'DRAFT',
          scope,
          categoryId: scope === 'CATEGORY' ? categoryId! : null,
          note: body?.note ?? null,
          createdById: user!.id,
          createdByName: await displayName(user!.id),
          totalItems: products.length,
          items: {
            // A snapshot, never re-read from the live product: the whole point of a stocktake is
            // to compare what was on the books when it started against what was on the shelf.
            create: products.map((p) => ({
              productId: p.id,
              productName: p.nameRu,
              productNameUz: p.nameUz,
              barcode: p.barcode,
              unit: p.unit,
              expectedQty: p.stock,
              cost: p.cost,
            })),
          },
        },
        select: { id: true, number: true, status: true, scope: true, totalItems: true },
      });

      return created;
    },
  },

  {
    method: 'GET',
    path: '/inventory-counts/:id',
    roles: ADMIN_ONLY,
    handler: async ({ params }) => {
      const count = await db().inventoryCount.findUnique({
        where: { id: params.id },
        include: { items: { orderBy: { productName: 'asc' } } },
      });
      if (!count) throw notFound('Stocktake not found');
      return count;
    },
  },

  {
    method: 'PATCH',
    path: '/inventory-counts/:id/items/:itemId',
    roles: ADMIN_ONLY,
    handler: async ({ params, body }) => {
      const countedQty = Number(body?.countedQty);
      if (!Number.isFinite(countedQty) || countedQty < 0) {
        throw badRequest('countedQty must be zero or more');
      }
      return applyCount(params.id, { itemId: params.itemId }, () => countedQty);
    },
  },

  {
    method: 'POST',
    path: '/inventory-counts/:id/scan',
    roles: ADMIN_ONLY,
    handler: async ({ params, body }) => {
      const barcode = String(body?.barcode ?? '').trim();
      if (!barcode) throw badRequest('barcode is required');
      const qty = body?.qty === undefined ? 1 : Number(body.qty);
      if (!Number.isFinite(qty)) throw badRequest('qty must be a number');

      // Scanning accumulates: each beep adds to the running figure for that line, which is how
      // someone counts a shelf without keeping a tally in their head.
      return applyCount(params.id, { barcode }, (current) => Math.max(0, current + qty));
    },
  },

  {
    method: 'POST',
    path: '/inventory-counts/:id/complete',
    roles: ADMIN_ONLY,
    handler: async ({ params, body, user }) => {
      const count = await db().inventoryCount.findUnique({
        where: { id: params.id },
        include: { items: true },
      });
      if (!count) throw notFound('Stocktake not found');
      if (!OPEN_STATUSES.includes(count.status)) throw badRequest('Stocktake is already closed');

      // An explicit list wins over the blanket flag, so a dashboard that sends both means the
      // list. An empty array therefore means "write nothing off", not "write everything off".
      const writeOff: WriteOffSelection = Array.isArray(body?.writeOffItemIds)
        ? new Set<string>(body.writeOffItemIds.map(String))
        : body?.writeOffUncounted === true;

      const plan = planCompletion(count.items, writeOff);
      // Load-bearing: without it, "create a count, count nothing, tick write-off" would zero the
      // document's entire scope in one click.
      if (plan.countedItems === 0) throw badRequest('Nothing counted yet');

      const completedAt = new Date();

      await db().$transaction(
        async (tx) => {
          for (const row of plan.rows) {
            await tx.product.update({
              where: { id: row.productId },
              data: { stock: row.countedQty, stockCountedAt: completedAt },
            });
            await tx.inventoryCountItem.update({
              where: { id: row.itemId },
              data: {
                countedQty: row.countedQty,
                difference: row.difference,
                writtenOff: row.writtenOff,
              },
            });
          }

          await tx.inventoryCount.update({
            where: { id: count.id },
            data: {
              status: 'COMPLETED',
              completedAt,
              completedById: user!.id,
              countedItems: plan.countedItems,
              totalDifference: plan.totalDifference.toString(),
              totalValueDiff: plan.totalValueDiff.toString(),
              wroteOffUncounted: plan.writtenOffItems > 0,
              writtenOffItems: plan.writtenOffItems,
              writeOffValue: plan.writeOffValue.toString(),
            },
          });
        },
        // A full-store count touches every product; the default 5s budget is not enough.
        { timeout: 120_000 },
      );

      return db().inventoryCount.findUnique({ where: { id: count.id }, select: SUMMARY_FIELDS });
    },
  },

  {
    method: 'POST',
    path: '/inventory-counts/:id/cancel',
    roles: ADMIN_ONLY,
    handler: async ({ params }) => {
      const count = await db().inventoryCount.findUnique({ where: { id: params.id } });
      if (!count) throw notFound('Stocktake not found');
      if (count.status === 'COMPLETED') throw badRequest('A completed stocktake cannot be cancelled');

      await db().inventoryCount.update({ where: { id: count.id }, data: { status: 'CANCELLED' } });
      return db().inventoryCount.findUnique({ where: { id: count.id }, select: SUMMARY_FIELDS });
    },
  },
];

/** Set or accumulate one line's counted quantity, and report the document's progress. */
async function applyCount(
  countId: string,
  locate: { itemId?: string; barcode?: string },
  next: (current: number) => number,
) {
  const count = await db().inventoryCount.findUnique({ where: { id: countId } });
  if (!count) throw notFound('Stocktake not found');
  if (!OPEN_STATUSES.includes(count.status)) throw badRequest('Stocktake is already closed');

  const item = await db().inventoryCountItem.findFirst({
    where: {
      countId,
      ...(locate.itemId ? { id: locate.itemId } : {}),
      ...(locate.barcode ? { barcode: locate.barcode } : {}),
    },
  });
  // For a scan this means the product is not in the document's scope — worth saying so rather
  // than silently ignoring the beep.
  if (!item) throw notFound(locate.barcode ? 'Product is not in this stocktake' : 'Item not found');

  const updated = await db().inventoryCountItem.update({
    where: { id: item.id },
    data: { countedQty: next(Number(item.countedQty ?? 0)), counted: true },
  });

  const [countedItems, totalItems] = await Promise.all([
    db().inventoryCountItem.count({ where: { countId, counted: true } }),
    db().inventoryCountItem.count({ where: { countId } }),
  ]);

  // The first counted line moves the document out of DRAFT.
  const status = count.status === 'DRAFT' ? 'IN_PROGRESS' : count.status;
  if (status !== count.status || count.countedItems !== countedItems) {
    await db().inventoryCount.update({ where: { id: countId }, data: { status, countedItems } });
  }

  return { item: updated, countedItems, totalItems, status };
}

async function displayName(userId: string): Promise<string> {
  const user = await db().user.findUnique({ where: { id: userId } });
  return user?.nameRu || user?.nameUz || user?.phone || 'Unknown';
}
