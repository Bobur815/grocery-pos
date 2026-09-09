import { ipcMain, BrowserWindow } from 'electron';
import { getAppConfig, updateConfig } from '../config/app-config';
import { getPrismaClient, writeStoreBootstrap, closeDatabase, initializeDatabase } from '../database/sqlite-client';
import { setServerToken } from '../sync/queue-manager';
import { seedLocalDatabase } from '../database/seed';

interface SetupCompleteData {
  storeId: string;
  terminalId: string;
  storeName: string;
  storeAddress: string;
  storePhone: string;
  storeStir: string;
  taxRate: string;
  syncInterval: string;
  token: string;
  serverUrl?: string;
  mode?: string;
  posAdminLocked?: boolean;
}

/**
 * The server this terminal will talk to.
 *
 * Falls back to the URL compiled in from `.env.pos` when the wizard sends nothing, so an older
 * renderer keeps working. Trailing slashes are stripped because every caller appends its own.
 */
function resolveServerUrl(candidate: string | undefined): string {
  const trimmed = (candidate ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/.+/i.test(trimmed) ? trimmed : getAppConfig().vpsApiUrl;
}

/**
 * Cache this store's manager-override password hash, if it has one.
 *
 * Silent and best-effort: nothing here is worth failing a setup over. A store with no override
 * configured, or a terminal that cannot reach the server at this moment, simply ends up with a
 * null column — and the POS then gates nothing, exactly as it does today.
 */
async function fetchSuperAdminPassword(
  serverUrl: string,
  token: string,
  prisma: ReturnType<typeof getPrismaClient>,
): Promise<void> {
  try {
    const response = await fetch(`${serverUrl}/store-config`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return;

    const body = (await response.json()) as { super_admin_password_hash?: string | null };
    // Only write when the server actually sent the field, so an older server that does not know
    // about it cannot silently clear an override this terminal already holds.
    if (!('super_admin_password_hash' in body)) return;

    await prisma.localConfig.update({
      where: { id: 'config' },
      data: { superAdminPassword: body.super_admin_password_hash ?? null },
    });
  } catch {
    // Offline, or an older server without the field — leave the column as it is.
  }
}

export function setupSetupHandlers(getSetupWindow: () => BrowserWindow | null, openMainWindow: () => Promise<void>): void {
  ipcMain.handle('setup:authenticate', async (_event, data: { phone: string; password: string; storeId: string; serverUrl?: string }) => {
    // The wizard chooses the server, not the build: a terminal being set up against staging must
    // authenticate there, and it is the only chance to say so before anything is written.
    const vpsApiUrl = resolveServerUrl(data.serverUrl);

    try {
      const response = await fetch(`${vpsApiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: data.phone,
          password: data.password,
          storeId: data.storeId,
          // Marks this as a terminal, not the web dashboard: an OFFLINE_ONLY store is refused
          // a dashboard session but must still be able to activate a till.
          client: 'pos',
        }),
      });

      if (!response.ok) {
        if (response.status === 404 || response.status === 400 || response.status === 401) {
          throw new Error('setup.errors.invalid_credentials');
        }
        const body = await response.json() as { message?: string };
        throw new Error(body.message || 'setup.errors.login_failed');
      }

      const body = await response.json() as {
        token: string;
        user: { id: string; phone: string; role: string; nameUz: string; nameRu: string };
      };

      // Validate that the returned token belongs to the requested storeId
      try {
        const parts = body.token.split('.');
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString()) as { storeId?: string | null; role?: string };
        if (payload.storeId && payload.storeId !== data.storeId) {
          throw new Error('setup.errors.store_mismatch');
        }
        // Only admins can do initial setup
        if (payload.role && payload.role !== 'ADMIN') {
          throw new Error('setup.errors.admin_required');
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('setup.errors.')) throw e;
        // Ignore decode errors — token format may vary
      }

      return {
        success: true,
        token: body.token,
        user: {
          phone: body.user.phone,
          nameRu: body.user.nameRu,
          nameUz: body.user.nameUz,
          role: body.user.role,
        },
      };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('setup.errors.')) throw e;
      throw new Error('setup.errors.network_error');
    }
  });

  ipcMain.handle('setup:complete', async (_event, data: SetupCompleteData) => {
    // 1. Write bootstrap so next launch opens the correct DB
    writeStoreBootstrap(data.storeId);

    // 2. Close existing DB (pos-local.db)
    await closeDatabase();

    // 3. Re-initialize with store-specific DB (pos-{storeId}.db)
    await initializeDatabase();

    // 4. Seed defaults (categories, system settings, etc.)
    await seedLocalDatabase();

    const prisma = getPrismaClient();

    // 5. Update LocalConfig with user-provided values.
    //
    // apiUrl is pinned to the URL setup actually authenticated against — now the one the operator
    // typed in the wizard, not whatever was compiled into this build. "The terminal talks to the
    // server it was set up against" stays the invariant.
    //
    // It is kept for an OFFLINE_ONLY store too. That store never syncs, but apiUrl means "where
    // the vendor's server is", not "where my dashboard is": the subscription check still uses it
    // when the shop happens to have internet, and a VPS login is the only way back in if the
    // local users table is ever lost. The LAN dashboard does not read it at all — the page is
    // served same-origin, so its API base is relative.
    //
    // mode/posAdminLocked are the one-time activation: the wizard pulled them from
    // GET /stores/{id}, and an OFFLINE_ONLY terminal never needs the network again after this.
    const serverUrl = resolveServerUrl(data.serverUrl);
    await prisma.localConfig.update({
      where: { id: 'config' },
      data: {
        storeId: data.storeId,
        storeName: data.storeName,
        terminalId: data.terminalId,
        apiUrl: serverUrl,
        mode: data.mode === 'OFFLINE_ONLY' ? 'OFFLINE_ONLY' : 'ONLINE',
        posAdminLocked: data.posAdminLocked === true,
      },
    });

    // 6. Override system settings with user-provided values
    const settingsToSet = [
      { key: 'store_name', value: data.storeName },
      { key: 'store_address', value: data.storeAddress },
      { key: 'store_phone', value: data.storePhone },
      { key: 'store_stir', value: data.storeStir },
      { key: 'tax_rate', value: data.taxRate },
      { key: 'sync_interval', value: data.syncInterval },
      { key: 'receipt_header', value: data.storeName },
    ];
    for (const s of settingsToSet) {
      await prisma.systemSetting.upsert({
        where: { key: s.key },
        update: { value: s.value },
        create: { key: s.key, value: s.value },
      });
    }

    // 7. Persist server token
    setServerToken(data.token);
    await prisma.systemSetting.upsert({
      where: { key: 'server_token' },
      update: { value: data.token },
      create: { key: 'server_token', value: data.token },
    });

    // 8. Update AppConfig to reflect new storeId/terminalId/server
    updateConfig({ storeId: data.storeId, terminalId: data.terminalId, vpsApiUrl: serverUrl });

    // 9. Pull the manager-override password hash.
    //
    // Fetched here in the main process rather than by the wizard's renderer, so the hash never
    // enters a browser context. It comes from /store-config, which is scoped to this token's own
    // store — /stores/{id} deliberately does not return it.
    //
    // Best-effort by design: an OFFLINE_ONLY store may already be off the network by now, and a
    // terminal with no override configured simply gates nothing. Failing setup over it would be
    // the wrong trade.
    await fetchSuperAdminPassword(serverUrl, data.token, prisma);

    return { success: true };
  });

  ipcMain.handle('setup:launchApp', async () => {
    await openMainWindow();
    // Close setup window after a short delay to allow main window to load
    setTimeout(() => {
      const sw = getSetupWindow();
      if (sw && !sw.isDestroyed()) {
        sw.close();
      }
    }, 800);
  });
}
