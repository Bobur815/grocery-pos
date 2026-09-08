import { boolParam, db, required } from '../helpers';
import { badRequest, notFound, type Route } from '../router';

/**
 * Suppliers and the running account with each of them.
 *
 * `balance` is signed: negative means the shop owes the supplier, positive means the supplier
 * owes the shop. Every write that moves it does so in the same transaction as the row that
 * caused the move, so the two can never disagree.
 */

const ADMIN_ONLY = ['ADMIN', 'SUPER_ADMIN'];

/** How each transaction type moves the supplier balance. Mirrors the server exactly. */
function balanceDelta(type: string, amount: number): number {
  return type === 'PURCHASE' ? -amount : amount;
}

export const supplierRoutes: Route[] = [
  {
    method: 'GET',
    path: '/suppliers',
    handler: ({ query }) => {
      const active = boolParam(query.active);
      return db().supplier.findMany({
        where: active !== undefined ? { active } : {},
        include: { categories: true },
        orderBy: { nameRu: 'asc' },
      });
    },
  },

  // Declared before `/suppliers/:id` so the literal segment is not captured as an id.
  {
    method: 'GET',
    path: '/suppliers/transactions',
    handler: ({ query }) =>
      db().supplierTransaction.findMany({
        where: {
          ...(query.supplierId ? { supplierId: query.supplierId } : {}),
          ...(query.type ? { type: query.type } : {}),
        },
        include: { supplier: { select: { id: true, nameRu: true, nameUz: true } } },
        orderBy: { createdAt: 'desc' },
      }),
  },

  {
    method: 'POST',
    path: '/suppliers/transactions',
    roles: ADMIN_ONLY,
    handler: ({ body, user }) => createTransaction(body, user!.id, body?.type),
  },

  {
    method: 'POST',
    path: '/suppliers/payments',
    roles: ADMIN_ONLY,
    handler: ({ body, user }) => createTransaction(body, user!.id, 'PAYMENT'),
  },

  {
    method: 'PUT',
    path: '/suppliers/transactions/:id',
    roles: ADMIN_ONLY,
    handler: async ({ params, body }) => {
      const existing = await db().supplierTransaction.findUnique({ where: { id: params.id } });
      if (!existing) throw notFound('Transaction not found');

      const type = body?.type ?? existing.type;
      const amount = body?.amount !== undefined ? Number(body.amount) : Number(existing.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw badRequest('amount must be > 0');

      return db().$transaction(async (tx) => {
        // Undo the old effect and apply the new one in a single step, so a failure part-way
        // cannot leave the balance reflecting neither.
        const shift =
          balanceDelta(type, amount) - balanceDelta(existing.type, Number(existing.amount));
        if (shift !== 0) {
          await tx.supplier.update({
            where: { id: existing.supplierId },
            data: { balance: { increment: shift } },
          });
        }
        return tx.supplierTransaction.update({
          where: { id: existing.id },
          data: {
            type,
            amount,
            ...(body?.paymentMethod !== undefined ? { paymentMethod: body.paymentMethod } : {}),
            ...(body?.description !== undefined ? { description: body.description } : {}),
          },
        });
      });
    },
  },

  {
    method: 'DELETE',
    path: '/suppliers/transactions/:id',
    roles: ADMIN_ONLY,
    handler: async ({ params }) => {
      const existing = await db().supplierTransaction.findUnique({ where: { id: params.id } });
      if (!existing) throw notFound('Transaction not found');

      await db().$transaction(async (tx) => {
        await tx.supplier.update({
          where: { id: existing.supplierId },
          data: { balance: { decrement: balanceDelta(existing.type, Number(existing.amount)) } },
        });
        await tx.supplierTransaction.delete({ where: { id: existing.id } });
      });
      return { success: true };
    },
  },

  {
    method: 'GET',
    path: '/suppliers/:id/balance',
    handler: async ({ params }) => {
      const supplier = await db().supplier.findUnique({ where: { id: params.id } });
      if (!supplier) throw notFound('Supplier not found');
      return { supplierId: supplier.id, balance: supplier.balance };
    },
  },

  {
    method: 'GET',
    path: '/suppliers/:id',
    handler: async ({ params }) => {
      const supplier = await db().supplier.findUnique({
        where: { id: params.id },
        include: {
          categories: true,
          arrivals: { include: { product: true }, orderBy: { createdAt: 'desc' }, take: 10 },
          transactions: { orderBy: { createdAt: 'desc' }, take: 100 },
          products: { where: { active: true } },
        },
      });
      if (!supplier) throw notFound('Supplier not found');
      return supplier;
    },
  },

  {
    method: 'POST',
    path: '/suppliers',
    roles: ADMIN_ONLY,
    handler: ({ body }) =>
      db().supplier.create({
        data: {
          nameUz: String(required(body?.nameUz, 'nameUz')),
          nameRu: String(required(body?.nameRu, 'nameRu')),
          phone: body?.phone ?? null,
          address: body?.address ?? null,
          balance: Number(body?.balance ?? 0),
          paymentType: body?.paymentType === 'INSTALLMENT' ? 'INSTALLMENT' : 'IMMEDIATE',
          ...(Array.isArray(body?.categoryIds) && body.categoryIds.length > 0
            ? { categories: { connect: body.categoryIds.map((id: number) => ({ id: Number(id) })) } }
            : {}),
        },
        include: { categories: true },
      }),
  },

  {
    method: 'PATCH',
    path: '/suppliers/:id',
    roles: ADMIN_ONLY,
    handler: async ({ params, body }) => {
      const existing = await db().supplier.findUnique({ where: { id: params.id } });
      if (!existing) throw notFound('Supplier not found');

      const data: Record<string, unknown> = {};
      for (const key of ['nameUz', 'nameRu', 'phone', 'address', 'paymentType', 'active'] as const) {
        if (body?.[key] !== undefined) data[key] = body[key];
      }
      if (body?.balance !== undefined) data.balance = Number(body.balance);
      if (Array.isArray(body?.categoryIds)) {
        // `set` rather than `connect` — the dashboard sends the full list it wants, so anything
        // absent from it has been unticked.
        data.categories = { set: body.categoryIds.map((id: number) => ({ id: Number(id) })) };
      }

      return db().supplier.update({
        where: { id: existing.id },
        data,
        include: { categories: true },
      });
    },
  },

  {
    method: 'DELETE',
    path: '/suppliers/:id',
    roles: ADMIN_ONLY,
    handler: async ({ params }) => {
      const supplier = await db().supplier.findUnique({ where: { id: params.id } });
      if (!supplier) throw notFound('Supplier not found');

      // A supplier with delivery history is part of the record and can only be retired; one that
      // never delivered anything was probably a mistake and can go entirely.
      const arrivals = await db().inventoryArrival.count({ where: { supplierId: supplier.id } });
      if (arrivals > 0) {
        await db().supplier.update({ where: { id: supplier.id }, data: { active: false } });
        return { success: true };
      }

      await db().$transaction(async (tx) => {
        await tx.supplierTransaction.deleteMany({ where: { supplierId: supplier.id } });
        await tx.supplier.delete({ where: { id: supplier.id } });
      });
      return { success: true, deleted: true };
    },
  },
];

async function createTransaction(body: any, userId: string, type: string) {
  const supplierId = String(required(body?.supplierId, 'supplierId'));
  const amount = Number(required(body?.amount, 'amount'));
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('amount must be > 0');
  if (!['PAYMENT', 'RETURN', 'ADVANCE'].includes(type)) {
    throw badRequest('type must be PAYMENT, RETURN or ADVANCE');
  }

  const supplier = await db().supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) throw notFound('Supplier not found');

  return db().$transaction(async (tx) => {
    const transaction = await tx.supplierTransaction.create({
      data: {
        supplierId,
        type,
        paymentMethod: body?.paymentMethod ?? 'CASH',
        amount,
        description: body?.description ?? null,
        referenceId: body?.referenceId ?? null,
        referenceType: body?.referenceType ?? null,
        createdBy: userId,
      },
    });

    await tx.supplier.update({
      where: { id: supplierId },
      data: { balance: { increment: balanceDelta(type, amount) } },
    });

    // Goods sent back to the supplier leave the shelf as well as the ledger.
    if (type === 'RETURN' && body?.referenceType === 'PRODUCT' && body?.referenceId) {
      const quantity = Number(body?.quantity ?? 0);
      if (quantity > 0) {
        await tx.product.update({
          where: { id: Number(body.referenceId) },
          data: { stock: { decrement: quantity } },
        });
      }
    }

    return transaction;
  });
}
