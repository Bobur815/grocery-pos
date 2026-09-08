import * as bcrypt from 'bcryptjs';
import { db, required } from '../helpers';
import { badRequest, notFound, type Route } from '../router';

/**
 * Users.
 *
 * The password hash is never returned. The VPS's `GET /users/:id` does include it — harmless
 * enough behind TLS and a super-admin session, but this server is plain HTTP on a shop Wi-Fi, and
 * handing out bcrypt hashes to anyone who reaches it is not a trade worth making for shape parity.
 */

const PUBLIC_FIELDS = {
  id: true,
  storeId: true,
  phone: true,
  role: true,
  nameUz: true,
  nameRu: true,
  active: true,
  createdAt: true,
} as const;

const ADMIN_ONLY = ['ADMIN', 'SUPER_ADMIN'];

export const userRoutes: Route[] = [
  {
    method: 'GET',
    path: '/users',
    roles: ADMIN_ONLY,
    handler: () => db().user.findMany({ select: PUBLIC_FIELDS, orderBy: { createdAt: 'desc' } }),
  },

  {
    method: 'GET',
    path: '/users/:id',
    roles: ADMIN_ONLY,
    handler: async ({ params }) => {
      const user = await db().user.findUnique({
        where: { id: params.id },
        select: PUBLIC_FIELDS,
      });
      if (!user) throw notFound('User not found');
      return user;
    },
  },

  {
    method: 'POST',
    path: '/users',
    roles: ADMIN_ONLY,
    handler: async ({ body }) => {
      const phone = String(required(body?.phone, 'phone'));
      const password = String(required(body?.password, 'password'));
      if (password.length < 6) throw badRequest('password must be at least 6 characters');

      if (await db().user.findUnique({ where: { phone } })) {
        throw badRequest('A user with this phone already exists');
      }

      const config = await db().localConfig.findUnique({ where: { id: 'config' } });
      return db().user.create({
        data: {
          phone,
          password: await bcrypt.hash(password, 10),
          role: body?.role === 'ADMIN' ? 'ADMIN' : 'USER',
          nameUz: String(required(body?.nameUz, 'nameUz')),
          nameRu: String(required(body?.nameRu, 'nameRu')),
          active: body?.active ?? true,
          storeId: config?.storeId ?? null,
        },
        select: PUBLIC_FIELDS,
      });
    },
  },

  {
    method: 'PATCH',
    path: '/users/:id',
    roles: ADMIN_ONLY,
    handler: async ({ params, body }) => {
      const existing = await db().user.findUnique({ where: { id: params.id } });
      if (!existing) throw notFound('User not found');

      const data: Record<string, unknown> = {};
      for (const key of ['nameUz', 'nameRu', 'phone', 'active'] as const) {
        if (body?.[key] !== undefined) data[key] = body[key];
      }
      if (body?.role !== undefined) data.role = body.role === 'ADMIN' ? 'ADMIN' : 'USER';
      if (body?.password) {
        if (String(body.password).length < 6) {
          throw badRequest('password must be at least 6 characters');
        }
        data.password = await bcrypt.hash(String(body.password), 10);
      }

      return db().user.update({ where: { id: existing.id }, data, select: PUBLIC_FIELDS });
    },
  },

  {
    method: 'PUT',
    path: '/users/:id/activate',
    roles: ADMIN_ONLY,
    handler: async ({ params }) => {
      await db().user.update({ where: { id: params.id }, data: { active: true } });
      return { success: true };
    },
  },

  {
    method: 'DELETE',
    path: '/users/:id',
    roles: ADMIN_ONLY,
    handler: async ({ params, user }) => {
      if (params.id === user!.id) throw badRequest('You cannot deactivate your own account');
      // Soft delete, matching the server: past receipts carry this cashier's name and must keep
      // resolving to a real row.
      await db().user.update({ where: { id: params.id }, data: { active: false } });
      return { success: true };
    },
  },
];
