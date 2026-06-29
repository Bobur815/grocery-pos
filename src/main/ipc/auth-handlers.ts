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

    // Get store config with PIN
    const localConfig = await prisma.localConfig.findUnique({
      where: { id: 'config' },
    });

    if (!localConfig || !localConfig.storePin) {
      throw new Error('auth.errors.pin_not_configured');
    }

    // Verify PIN
    const isPinValid = await bcrypt.compare(pin, localConfig.storePin);
    if (!isPinValid) {
      throw new Error('auth.errors.invalid_pin');
    }

    // Find default cashier (first active USER belonging to this store)
    const cashier = await prisma.user.findFirst({
      where: {
        role: 'USER',
        active: true,
        ...(localConfig?.storeId ? { storeId: localConfig.storeId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!cashier) {
      throw new Error('auth.errors.no_cashier_found');
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        sub: cashier.id,
        phone: cashier.phone,
        role: cashier.role,
      },
      config.jwtSecret || 'local-secret-key',
      {
        expiresIn: '8h',
      }
    );

    // Store token for sync operations
    await setAuthToken(token);

    // Restore persisted server token — only if it belongs to the same store
    const pinLocalConfig = await prisma.localConfig.findUnique({ where: { id: 'config' } });
    const pinStoreId = pinLocalConfig?.storeId ?? null;
    const serverTokenSetting = await prisma.systemSetting.findUnique({ where: { key: 'server_token' } });
    if (serverTokenSetting?.value) {
      const decoded = decodeTokenStoreId(serverTokenSetting.value);
      if (decoded && !decoded.expired && decoded.storeId === pinStoreId) {
        setServerToken(serverTokenSetting.value);
      }
    }

    // Set current user
    currentUser = {
      id: cashier.id,
      phone: cashier.phone,
      role: cashier.role,
      nameUz: cashier.nameUz,
      nameRu: cashier.nameRu,
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

      // Restore server token — only if it belongs to the same store as LocalConfig
      const restoreStoreId = restoreLocalConfig?.storeId ?? null;
      const serverTokenSetting = await prisma.systemSetting.findUnique({ where: { key: 'server_token' } });
      if (serverTokenSetting?.value) {
        const decoded = decodeTokenStoreId(serverTokenSetting.value);
        if (decoded && !decoded.expired && decoded.storeId === restoreStoreId) {
          setServerToken(serverTokenSetting.value);
        }
      }

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

    return prisma.user.findMany({
      where: storeId ? { storeId } : {},
      select: {
        id: true,
        phone: true,
        role: true,
        nameUz: true,
        nameRu: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  ipcMain.handle('users:create', async (_event, data) => {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      throw new Error('Unauthorized');
    }

    const prisma = getPrismaClient();

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 10);

    const localConfig = await prisma.localConfig.findUnique({ where: { id: 'config' } });

    const user = await prisma.user.create({
      data: {
        phone: data.phone,
        password: hashedPassword,
        role: data.role || 'USER',
        nameUz: data.nameUz,
        nameRu: data.nameRu,
        active: true,
        storeId: localConfig?.storeId ?? null,
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

  ipcMain.handle('auth:isPinConfigured', async () => {
    const prisma = getPrismaClient();
    const config = await prisma.localConfig.findUnique({
      where: { id: 'config' },
      select: { storePin: true },
    });
    return !!(config?.storePin);
  });

  ipcMain.handle('auth:setupPin', async (_event, pin: string) => {
    if (!currentUser) {
      throw new Error('Not authenticated');
    }
    if (!/^\d{4}$/.test(pin)) {
      throw new Error('auth.errors.invalid_pin_format');
    }

    const prisma = getPrismaClient();
    const hashedPin = await bcrypt.hash(pin, 10);
    await prisma.localConfig.update({
      where: { id: 'config' },
      data: { storePin: hashedPin },
    });

    return true;
  });
}

export function getCurrentUser() {
  return currentUser;
}
