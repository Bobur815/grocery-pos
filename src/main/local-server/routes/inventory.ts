import { dateParam, db, intParam, numberParam, required } from '../helpers';
import { badRequest, notFound, type Route } from '../router';

/** Goods arriving from a supplier, and the low-stock list. */

const ADMIN_ONLY = ['ADMIN', 'SUPER_ADMIN'];

export const inventoryRoutes: Route[] = [
  {
    method: 'GET',
    path: '/inventory/arrivals',
    handler: ({ query }) => {
      const productId = intParam(query.productId);
      const startDate = dateParam(query.startDate, 'startDate');
      return db().inventoryArrival.findMany({
        where: {
          ...(productId !== undefined ? { productId } : {}),
          ...(startDate ? { createdAt: { gte: startDate } } : {}),
        },
        include: { product: true, supplier: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    },
  },

  {
    method: 'POST',
    path: '/inventory/arrivals',
    roles: ADMIN_ONLY,
    handler: async ({ body, user }) => {
      const productId = intParam(String(required(body?.productId, 'productId')));
      if (productId === undefined) throw badRequest('Invalid productId');
      const quantity = Number(required(body?.quantity, 'quantity'));
      if (!Number.isFinite(quantity) || quantity <= 0) throw badRequest('quantity must be > 0');

      const product = await db().product.findUnique({ where: { id: productId } });
      if (!product) throw notFound('Product not found');

      const cost = numberParam(body?.cost != null ? String(body.cost) : undefined);
      const newPrice = numberParam(body?.newPrice != null ? String(body.newPrice) : undefined);

      return db().$transaction(async (tx) => {
        const arrival = await tx.inventoryArrival.create({
          data: {
            productId,
            quantity,
            cost: cost ?? 0,
            totalCost: (cost ?? 0) * quantity,
            supplierId: body?.supplierId || null,
            notes: body?.notes ?? null,
            createdBy: user!.id,
          },
        });

        const productUpdate: Record<string, unknown> = { stock: { increment: quantity } };
        if (cost !== undefined) productUpdate.cost = cost;
        if (newPrice !== undefined) {
          // 'deferred' holds the new price until the old stock is sold through; the till applies
          // it when the shelf runs down, so it is parked rather than applied here.
          if (body?.priceMode === 'deferred') productUpdate.pendingPrice = newPrice;
          else productUpdate.price = newPrice;
        }
        await tx.product.update({ where: { id: productId }, data: productUpdate });

        // Goods received on credit put the shop into debt with the supplier.
        if (body?.supplierId && cost) {
          const amount = cost * quantity;
          await tx.supplierTransaction.create({
            data: {
              supplierId: body.supplierId,
              type: 'PURCHASE',
              paymentMethod: body?.paymentMethod ?? 'CASH',
              amount,
              description: `Arrival: ${product.nameRu}`,
              referenceId: arrival.id,
              referenceType: 'ARRIVAL',
              createdBy: user!.id,
            },
          });
          await tx.supplier.update({
            where: { id: body.supplierId },
            data: { balance: { decrement: amount } },
          });
        }

        return tx.inventoryArrival.findUnique({
          where: { id: arrival.id },
          include: { product: true, supplier: true },
        });
      });
    },
  },

  {
    method: 'PATCH',
    path: '/inventory/arrivals/:id',
    roles: ADMIN_ONLY,
    handler: async ({ params, body }) => {
      const existing = await db().inventoryArrival.findUnique({ where: { id: params.id } });
      if (!existing) throw notFound('Arrival not found');

      const quantity = body?.quantity !== undefined ? Number(body.quantity) : Number(existing.quantity);
      const cost = body?.cost !== undefined ? Number(body.cost) : Number(existing.cost ?? 0);
      if (!Number.isFinite(quantity) || quantity <= 0) throw badRequest('quantity must be > 0');

      return db().$transaction(async (tx) => {
        // Correct the stock by the difference, not by the new figure: the original quantity was
        // already added when the delivery was booked in.
        const delta = quantity - Number(existing.quantity);
        if (delta !== 0) {
          await tx.product.update({
            where: { id: existing.productId },
            data: { stock: { increment: delta } },
          });
        }

        const totalCost = cost * quantity;

        // The supplier's debt was raised by the original total, so it moves by the difference too.
        if (existing.supplierId) {
          const oldTotal = Number(existing.totalCost ?? 0);
          if (totalCost !== oldTotal) {
            await tx.supplierTransaction.updateMany({
              where: { referenceId: existing.id, referenceType: 'ARRIVAL' },
              data: { amount: totalCost },
            });
            await tx.supplier.update({
              where: { id: existing.supplierId },
              data: { balance: { decrement: totalCost - oldTotal } },
            });
          }
        }

        return tx.inventoryArrival.update({
          where: { id: existing.id },
          data: {
            quantity,
            cost,
            totalCost,
            ...(body?.notes !== undefined ? { notes: body.notes } : {}),
          },
          include: { product: { select: { id: true, nameRu: true, nameUz: true } } },
        });
      });
    },
  },

  {
    method: 'GET',
    path: '/inventory/low-stock',
    roles: ADMIN_ONLY,
    handler: async () => {
      // Filtered in JS rather than SQL because Prisma cannot compare two columns in a `where`.
      // The catalogue of a single shop is small enough that this costs nothing.
      const products = await db().product.findMany({
        where: { active: true },
        include: { category: true },
        orderBy: { stock: 'asc' },
      });
      return products.filter((p) => Number(p.stock) <= Number(p.minStock));
    },
  },
];
