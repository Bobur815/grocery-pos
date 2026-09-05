import { ipcMain } from 'electron';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { getPrismaClient } from '../database/sqlite-client';
import { setAuthToken, clearAuthToken, setServerToken, clearServerToken } from '../sync/queue-manager';
import { getAppConfig } from '../config/app-config';
import type { AuthUser } from '../../shared/types/user.types';

interface JwtPayload {
  sub: string;
  phone: string;
  role: string;
  iat: number;
  exp: number;
}

function decodeTokenStoreId(token: string): { storeId: string | null; expired: boolean } | null {
  try {
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString()) as { storeId?: string | null; exp?: number };
    const expired = !!payload.exp && payload.exp * 1000 <= Date.now();
    return { storeId: payload.storeId ?? null, expired };
  } catch {
    return null;
  }
}

let currentUser: AuthUser | null = null;

/**
 * Re-arm the VPS token kept from an earlier password login.
 *
 * A PIN login never reaches the VPS — it has no password to send — so this stored token is the
 * only credential a PIN-only terminal holds for uploading its sales and shifts. Whatever is
 * unusable gets deleted rather than left lying around: a dead token makes the sync loop 401 on
 * every request instead of reporting that nobody has signed in with a password recently.
 *
 * Returns whether a usable token was restored.
 */
async function restorePersistedServerToken(
  prisma: ReturnType<typeof getPrismaClient>,
  storeId: string | null,
): Promise<boolean> {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'server_token' } });
  if (!setting?.value) return false;

  const decoded = decodeTokenStoreId(setting.value);
  if (decoded && !decoded.expired && decoded.storeId === storeId) {
    setServerToken(setting.value);
    return true;
  }

  const reason = !decoded
    ? 'unreadable'
    : decoded.expired
      ? 'expired'
      : `issued for store ${decoded.storeId ?? 'null'}`;
  console.warn(
    `[auth] Dropping the stored VPS token (${reason}). Sales and shifts keep queueing locally ` +
    'until someone signs in with a phone and password.',
  );
  clearServerToken();
  await prisma.systemSetting.deleteMany({ where: { key: 'server_token' } });
  return false;
}

/** A quick-login PIN is 1 to 4 digits — short by design, it only ever unlocks a local session. */
const PIN_PATTERN = /^\d{1,4}$/;

type PinCandidate = { id: string; pin: string | null };

/**
 * Active users of this terminal's store that carry a PIN.
 *
 * The store scope matters: a terminal caches users from whichever store it was last set up
 * against, and a stale row from another store must never be able to unlock this one.
 */
async function usersWithPin(
  prisma: ReturnType<typeof getPrismaClient>,
  extra: { excludeUserId?: string } = {},
): Promise<PinCandidate[]> {
  const localConfig = await prisma.localConfig.findUnique({ where: { id: 'config' } });
  const storeId = localConfig?.storeId;

  return prisma.user.findMany({
    where: {
      active: true,
      pin: { not: null },
      ...(storeId ? { storeId } : {}),
      ...(extra.excludeUserId ? { id: { not: extra.excludeUserId } } : {}),
    },
    select: { id: true, pin: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** The user whose PIN this is, or null. Compares against every candidate — PINs are not unique by construction. */
async function findUserIdByPin(
  prisma: ReturnType<typeof getPrismaClient>,
  pin: string,
): Promise<string | null> {
  for (const candidate of await usersWithPin(prisma)) {
    if (candidate.pin && (await bcrypt.compare(pin, candidate.pin))) return candidate.id;
  }
  return null;
}

/**
 * Hash a PIN for `userId`, rejecting a PIN another active user already owns.
 *
 * Two people sharing a PIN would make PIN login ambiguous — whoever was created first would
 * silently take over the other's session, including their shift and their name on the receipt.
 */
async function hashNewPin(
  prisma: ReturnType<typeof getPrismaClient>,
  pin: string,
  userId: string,
): Promise<string> {
  if (!PIN_PATTERN.test(pin)) {
    throw new Error('auth.errors.invalid_pin_format');
  }
  for (const candidate of await usersWithPin(prisma, { excludeUserId: userId })) {
    if (candidate.pin && (await bcrypt.compare(pin, candidate.pin))) {
      throw new Error('auth.errors.pin_taken');
    }
  }
  return bcrypt.hash(pin, 10);
}

export function setupAuthHandlers(): void {
  ipcMain.handle('auth:login', async (_event, phone: string, password: string) => {
    const prisma = getPrismaClient();
    const config = getAppConfig();

    // Use storeId from LocalConfig (authoritative) rather than env-based app-config
    const localConfig = await prisma.localConfig.findUnique({ where: { id: 'config' } });
    const storeId = localConfig?.storeId || config.storeId;
    const vpsApiUrl = localConfig?.apiUrl || config.vpsApiUrl;

    console.log(`[auth:login] phone=${phone} terminal_storeId=${storeId}`);

    // Find user in local database
    let user = await prisma.user.findUnique({ where: { phone } });

    console.log(`[auth:login] local user found:`, user ? `id=${user.id} role=${user.role} storeId=${user.storeId} active=${user.active}` : 'null');

    // Reject users whose storeId is set to a different store — they don't belong here
    if (user && user.storeId && user.storeId !== storeId) {
      console.log(`[auth:login] BLOCKED local user — storeId mismatch: user.storeId=${user.storeId} terminal=${storeId}`);
      user = null;
    }

    let serverTokenObtained = false;

    if (!user) {
      // User not in local DB — try VPS (covers new terminal setup or user only on server)
      let synced = false;
      try {
        console.log(`[auth:login] calling VPS login — storeId=${storeId} phone=${phone}`);
        const serverRes = await fetch(`${vpsApiUrl}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storeId, phone, password }),
        });
        console.log(`[auth:login] VPS response status: ${serverRes.status}`);
        if (serverRes.ok) {
          const body = await serverRes.json() as { token: string; user: { id: string; phone: string; role: string; nameUz: string; nameRu: string } };
          // Decode and log the full token payload for debugging
          let rawPayload: Record<string, unknown> = {};
          try { rawPayload = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64').toString()); } catch { /* ignore */ }
          console.log(`[auth:login] VPS token payload:`, JSON.stringify(rawPayload));
          // Reject if VPS token belongs to a different store
          const tokenInfo = decodeTokenStoreId(body.token);
          console.log(`[auth:login] token storeId=${tokenInfo?.storeId} terminal storeId=${storeId} — match=${tokenInfo?.storeId === storeId}`);
          if (tokenInfo?.storeId && tokenInfo.storeId !== storeId) {
            console.log(`[auth:login] BLOCKED — VPS token storeId mismatch`);
            throw new Error('auth.errors.store_mismatch');
          }
          if (!tokenInfo?.storeId) {
            console.warn(`[auth:login] WARNING — VPS token has no storeId claim; cannot verify store ownership`);
          }
          setServerToken(body.token);
          serverTokenObtained = true;
          await prisma.systemSetting.upsert({
            where: { key: 'server_token' },
            update: { value: body.token },
            create: { key: 'server_token', value: body.token },
          });
          // Create user locally so offline logins work in future
          const hashedPassword = await bcrypt.hash(password, 10);
          user = await prisma.user.upsert({
            where: { phone },
            update: { password: hashedPassword, role: body.user.role, nameUz: body.user.nameUz, nameRu: body.user.nameRu, active: true, storeId },
            create: {
              id: body.user.id,
              phone: body.user.phone,
              password: hashedPassword,
              role: body.user.role,
              nameUz: body.user.nameUz,
              nameRu: body.user.nameRu,
              active: true,
              storeId,
            },
          });
          synced = true;
        } else if (serverRes.status === 404 || serverRes.status === 400) {
          // Store not found on VPS — storeId is likely wrong
          throw new Error('auth.errors.server_not_configured');
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('auth.errors.')) throw e;
        // VPS unreachable — fall through
      }
      if (!synced) {
        throw new Error('auth.errors.user_not_found');
      }
    }

    if (!user!.active) {
      throw new Error('auth.errors.user_deactivated');
    }

    console.log(`[auth:login] proceeding with user id=${user!.id} storeId=${user!.storeId} role=${user!.role}`);

    // Verify password against local hash
    const isValidPassword = await bcrypt.compare(password, user!.password);
    console.log(`[auth:login] local password match: ${isValidPassword}`);

    if (!isValidPassword) {
      // Local hash may be stale (password changed on web) — try VPS as fallback
      let vpsAccepted = false;
      try {
        const serverRes = await fetch(`${vpsApiUrl}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storeId, phone, password }),
        });
        if (serverRes.ok) {
          const { token: sToken } = await serverRes.json() as { token: string };
          // Reject if VPS token belongs to a different store
          const tokenInfo = decodeTokenStoreId(sToken);
          if (tokenInfo?.storeId && tokenInfo.storeId !== storeId) {
            throw new Error('auth.errors.store_mismatch');
          }
          vpsAccepted = true;
          serverTokenObtained = true;
          setServerToken(sToken);
          await prisma.systemSetting.upsert({
            where: { key: 'server_token' },
            update: { value: sToken },
            create: { key: 'server_token', value: sToken },
          });
          // Sync local hash so future offline logins use the new password
          const hashedPassword = await bcrypt.hash(password, 10);
          await prisma.user.update({ where: { phone }, data: { password: hashedPassword, storeId } });
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('auth.errors.')) throw e;
        // VPS unreachable — fall through to invalid_password
      }
      if (!vpsAccepted) {
        throw new Error('auth.errors.invalid_password');
      }
    }

    // Generate JWT token (for local use and sync)
    const token = jwt.sign(
      {
        sub: user.id,
        phone: user.phone,
        role: user.role,
      },
      config.jwtSecret || 'local-secret-key',
      {
        expiresIn: '8h',
      }
    );

    // Store token for sync operations
    await setAuthToken(token);

    // Login to VPS to get a server-issued token (skip if already obtained in fallback above)
    if (!serverTokenObtained) try {
      const serverRes = await fetch(`${vpsApiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, phone, password }),
      });
      if (serverRes.ok) {
        const { token: sToken } = await serverRes.json() as { token: string };
        // Only use server token if it belongs to this store
        const tokenInfo = decodeTokenStoreId(sToken);
        if (tokenInfo?.storeId && tokenInfo.storeId !== storeId) {
          console.warn(`VPS returned token for store ${tokenInfo.storeId}, expected ${storeId} — skipping server token`);
        } else {
          setServerToken(sToken);
          await prisma.systemSetting.upsert({
            where: { key: 'server_token' },
            update: { value: sToken },
            create: { key: 'server_token', value: sToken },
          });
        }
      } else {
        const text = await serverRes.text();
        console.warn(`VPS login failed (${serverRes.status}): ${text} — storeId: ${storeId}, phone: ${phone}`);
        const existingSetting = await prisma.systemSetting.findUnique({ where: { key: 'server_token' } });
        if (existingSetting?.value) {
          const decoded = decodeTokenStoreId(existingSetting.value);
          if (decoded && !decoded.expired && decoded.storeId === storeId) {
            setServerToken(existingSetting.value);
          }
        }
      }
    } catch (err) {
      console.warn('VPS login error (server unreachable):', err);
      const existingSetting = await prisma.systemSetting.findUnique({ where: { key: 'server_token' } });
      if (existingSetting?.value) {
        try {
          const parts = existingSetting.value.split('.');
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString()) as { exp?: number };
          if (!payload.exp || payload.exp * 1000 > Date.now()) {
            setServerToken(existingSetting.value);
          }
        } catch {
          // Invalid token format — ignore
        }
      }
    }

    // Set current user
    currentUser = {
      id: user.id,
      phone: user.phone,
      role: user.role,
      nameUz: user.nameUz,
      nameRu: user.nameRu,
    };

    return {
      token,
      user: currentUser,
    };
  });

  ipcMain.handle('auth:loginWithPin', async (_event, pin: string) => {
    const prisma = getPrismaClient();
    const config = getAppConfig();

    // The PIN identifies the person, so the session belongs to whoever owns it — a cashier or
    // an admin. Nobody on this terminal having a PIN is a different failure from a wrong PIN:
    // the login screen uses it to fall back to phone + password instead of showing an error.
    if ((await usersWithPin(prisma)).length === 0) {
      throw new Error('auth.errors.pin_not_configured');
    }

    const matchedUserId = await findUserIdByPin(prisma, pin);
    if (!matchedUserId) {
      throw new Error('auth.errors.invalid_pin');
    }

    const pinUser = await prisma.user.findUnique({ where: { id: matchedUserId } });
    if (!pinUser || !pinUser.active) {
      throw new Error('auth.errors.user_deactivated');
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        sub: pinUser.id,
        phone: pinUser.phone,
        role: pinUser.role,
      },
      config.jwtSecret || 'local-secret-key',
      {
        expiresIn: '8h',
      }
    );

    // Store token for sync operations
    await setAuthToken(token);

    // Restore the persisted server token — a PIN login mints no new one.
    const pinLocalConfig = await prisma.localConfig.findUnique({ where: { id: 'config' } });
    await restorePersistedServerToken(prisma, pinLocalConfig?.storeId ?? null);

    // Set current user
    currentUser = {
      id: pinUser.id,
      phone: pinUser.phone,
      role: pinUser.role,
      nameUz: pinUser.nameUz,
      nameRu: pinUser.nameRu,
    };

    return {
      token,
      user: currentUser,
    };
  });

  ipcMain.handle('auth:logout', async () => {
    const prisma = getPrismaClient();

    // Clear tokens and user
    await clearAuthToken();
    clearServerToken();
    await prisma.systemSetting.deleteMany({ where: { key: 'server_token' } });
    currentUser = null;
  });

  ipcMain.handle('auth:getProfile', async () => {
    if (!currentUser) {
      throw new Error('Not authenticated');
    }
    return currentUser;
  });

  // Restore session from stored token (called on app start)
  ipcMain.handle('auth:restoreSession', async (_event, token: string) => {
    if (!token) {
      return null;
    }

    const config = getAppConfig();

    try {
      // Verify the token
      const decoded = jwt.verify(token, config.jwtSecret || 'local-secret-key') as JwtPayload;

      // Get user from database
      const prisma = getPrismaClient();
      const user = await prisma.user.findUnique({
        where: { id: decoded.sub },
      });

      if (!user || !user.active) {
        return null;
      }

      // Reject if the restored user belongs to a different store
      const restoreLocalConfig = await prisma.localConfig.findUnique({ where: { id: 'config' } });
      if (restoreLocalConfig?.storeId && user.storeId && user.storeId !== restoreLocalConfig.storeId) {
        return null;
      }

      // Restore current user
      currentUser = {
        id: user.id,
        phone: user.phone,
        role: user.role,
        nameUz: user.nameUz,
        nameRu: user.nameRu,
      };

      // Restore token for sync
      await setAuthToken(token);

      // Restore the server token — only if it belongs to the same store as LocalConfig.
      await restorePersistedServerToken(prisma, restoreLocalConfig?.storeId ?? null);

      return currentUser;
    } catch (err) {
      // Token invalid or expired
      console.error('Session restore failed:', err);
      return null;
    }
  });

  // Users management (Admin only)
  ipcMain.handle('users:getAll', async () => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      throw new Error('Unauthorized');
    }

    const prisma = getPrismaClient();
    const localConfig = await prisma.localConfig.findUnique({ where: { id: 'config' } });
    const storeId = localConfig?.storeId;

    const users = await prisma.user.findMany({
      where: storeId ? { storeId } : {},
      select: {
        id: true,
        phone: true,
        role: true,
        nameUz: true,
        nameRu: true,
        active: true,
        createdAt: true,
        pin: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // The hash never leaves the main process — the UI only needs to know a PIN exists.
    return users.map(({ pin, ...user }: { pin: string | null }) => ({ ...user, hasPin: !!pin }));
  });

  ipcMain.handle('users:create', async (_event, data) => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      throw new Error('Unauthorized');
    }

    const prisma = getPrismaClient();

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 10);

    const localConfig = await prisma.localConfig.findUnique({ where: { id: 'config' } });

    // Hashed before the insert so a rejected PIN never leaves a half-created user behind.
    const hashedPin = data.pin ? await hashNewPin(prisma, data.pin, '') : null;

    const user = await prisma.user.create({
      data: {
        phone: data.phone,
        password: hashedPassword,
        role: data.role || 'USER',
        nameUz: data.nameUz,
        nameRu: data.nameRu,
        active: true,
        storeId: localConfig?.storeId ?? null,
        pin: hashedPin,
      },
      select: {
        id: true,
        phone: true,
        role: true,
        nameUz: true,
        nameRu: true,
        active: true,
      },
    });

    return user;
  });

  ipcMain.handle('users:update', async (_event, id: string, data) => {
    if (!currentUser || (currentUser.role !== 'ADMIN' && currentUser.id !== id)) {
      throw new Error('Unauthorized');
    }

    const prisma = getPrismaClient();
    const updateData: Record<string, unknown> = {};

    if (data.nameUz) updateData.nameUz = data.nameUz;
    if (data.nameRu) updateData.nameRu = data.nameRu;
    if (data.active !== undefined && currentUser.role === 'ADMIN') {
      updateData.active = data.active;
    }
    if (data.role && currentUser.role === 'ADMIN') {
      updateData.role = data.role;
    }
    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 10);
    }
    // undefined = leave the PIN alone, null/'' = clear it, digits = replace it.
    if (data.pin !== undefined) {
      updateData.pin = data.pin ? await hashNewPin(prisma, data.pin, id) : null;
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        phone: true,
        role: true,
        nameUz: true,
        nameRu: true,
        active: true,
      },
    });

    return user;
  });

  ipcMain.handle('auth:changePassword', async (_event, currentPassword: string, newPassword: string) => {
    if (!currentUser) {
      throw new Error('Not authenticated');
    }

    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({ where: { id: currentUser.id } });

    if (!user) {
      throw new Error('User not found');
    }

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      throw new Error('auth.errors.invalid_password');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: currentUser.id },
      data: { password: hashedPassword },
    });

    return true;
  });

  ipcMain.handle('users:delete', async (_event, id: string) => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      throw new Error('Unauthorized');
    }

    if (currentUser.id === id) {
      throw new Error('Cannot delete your own account');
    }

    const prisma = getPrismaClient();

    // Soft delete (deactivate)
    await prisma.user.update({
      where: { id },
      data: { active: false },
    });

    return true;
  });

  // Whether PIN login is offered at all on this terminal — true as soon as anyone here has a PIN.
  ipcMain.handle('auth:isPinConfigured', async () => {
    const prisma = getPrismaClient();
    return (await usersWithPin(prisma)).length > 0;
  });

  // Whether the signed-in user personally has a PIN (drives "set up your PIN" after a password login).
  ipcMain.handle('auth:hasPin', async () => {
    if (!currentUser) return false;
    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { pin: true },
    });
    return !!user?.pin;
  });

  ipcMain.handle('auth:removePin', async () => {
    if (!currentUser) {
      throw new Error('Not authenticated');
    }
    const prisma = getPrismaClient();
    await prisma.user.update({ where: { id: currentUser.id }, data: { pin: null } });
    return true;
  });

  // Side-effect-free credential check, used to gate terminal-level settings on the login screen
  // (changing the server URL from an unauthenticated screen would otherwise let anyone repoint
  // this terminal at a server of their choosing). Deliberately NOT auth:loginWithPin — that
  // starts a session. Accepts any staff PIN, or an active admin's password.
  ipcMain.handle('auth:verifyTerminalAccess', async (_event, secret: string) => {
    if (!secret) return false;
    const prisma = getPrismaClient();

    if (PIN_PATTERN.test(secret) && (await findUserIdByPin(prisma, secret))) {
      return true;
    }

    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', active: true },
      select: { password: true },
    });
    for (const admin of admins) {
      if (await bcrypt.compare(secret, admin.password)) return true;
    }
    return false;
  });

  // Sets the signed-in user's own PIN. Deliberately does not ask for the password again: the
  // session is already authenticated, and a locked terminal is what stands between the two.
  ipcMain.handle('auth:setupPin', async (_event, pin: string) => {
    if (!currentUser) {
      throw new Error('Not authenticated');
    }

    const prisma = getPrismaClient();
    const hashedPin = await hashNewPin(prisma, pin, currentUser.id);
    await prisma.user.update({
      where: { id: currentUser.id },
      data: { pin: hashedPin },
    });

    return true;
  });
}

export function getCurrentUser() {
  return currentUser;
}
