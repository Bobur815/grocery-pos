import * as bcrypt from 'bcryptjs';
import { authenticate, publicUser, signToken } from '../auth';
import { db, required } from '../helpers';
import { badRequest, notFound, unauthorized, type Route } from '../router';

/**
 * Auth for the LAN dashboard.
 *
 * The SPA posts `{storeId?, phone, password}` and expects `{token, user}` back, then sends the
 * token as a bearer on everything else. `storeId` is ignored: the terminal's database holds
 * exactly one store, so there is nothing to select between.
 */
export const authRoutes: Route[] = [
  {
    method: 'POST',
    path: '/auth/login',
    public: true,
    handler: async ({ body }) => {
      const phone = String(required(body?.phone, 'phone'));
      const password = String(required(body?.password, 'password'));
      const user = await authenticate(phone, password);

      await recordSession(user.id, undefined);

      return {
        token: signToken({ sub: user.id, phone: user.phone, role: user.role }),
        user: publicUser(user),
      };
    },
  },

  {
    method: 'POST',
    path: '/auth/logout',
    handler: () => {
      // The token is stateless and short-lived, so there is nothing to revoke server-side; the
      // SPA drops it from localStorage. Answering 200 keeps its logout flow from erroring.
      return { success: true };
    },
  },

  {
    method: 'GET',
    path: '/auth/profile',
    handler: async ({ user }) => {
      const row = await db().user.findUnique({ where: { id: user!.id } });
      if (!row) throw unauthorized('Account no longer exists');
      return publicUser(row);
    },
  },

  {
    method: 'POST',
    path: '/auth/change-password',
    handler: async ({ user, body }) => {
      const currentPassword = String(required(body?.currentPassword, 'currentPassword'));
      const newPassword = String(required(body?.newPassword, 'newPassword'));
      if (newPassword.length < 6) throw badRequest('newPassword must be at least 6 characters');

      const row = await db().user.findUnique({ where: { id: user!.id } });
      if (!row) throw notFound('User not found');
      if (!(await bcrypt.compare(currentPassword, row.password))) {
        throw unauthorized('Current password is incorrect');
      }

      await db().user.update({
        where: { id: row.id },
        data: { password: await bcrypt.hash(newPassword, 10) },
      });
      return { success: true };
    },
  },

  /**
   * Device sessions.
   *
   * On the VPS these are rows in a `UserSession` table that does not exist on a terminal, and
   * the local tokens are stateless. Rather than invent a half-working device list, the endpoints
   * answer honestly: one entry for the browser asking, and revocation reports that there is
   * nothing to revoke. The dashboard's Devices page renders this without erroring.
   */
  {
    method: 'GET',
    path: '/auth/sessions',
    handler: async ({ user, req }) => [
      {
        id: 'local',
        userAgent: req.headers['user-agent'] ?? null,
        ipAddress: req.socket.remoteAddress ?? null,
        deviceName: null,
        createdAt: new Date().toISOString(),
        isCurrent: true,
        isRevoked: false,
        userId: user!.id,
      },
    ],
  },

  {
    method: 'DELETE',
    path: '/auth/sessions/others',
    handler: () => ({ revoked: 0 }),
  },

  {
    method: 'DELETE',
    path: '/auth/sessions/:id',
    handler: () => ({ success: true }),
  },

  {
    method: 'PATCH',
    path: '/auth/sessions/device-name',
    handler: () => ({ success: true }),
  },
];

/**
 * Note the login for the terminal's own log.
 *
 * There is no session table to write to, so this only leaves a trace in the app log — enough for
 * a shopkeeper to notice a login they did not make, without pretending to offer revocation.
 */
async function recordSession(userId: string, deviceName: string | undefined): Promise<void> {
  console.log(`[local-server] dashboard login: user=${userId}${deviceName ? ` (${deviceName})` : ''}`);
}
