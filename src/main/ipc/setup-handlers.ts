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
  mode?: string;
  posAdminLocked?: boolean;
}

export function setupSetupHandlers(getSetupWindow: () => BrowserWindow | null, openMainWindow: () => Promise<void>): void {
  ipcMain.handle('setup:authenticate', async (_event, data: { phone: string; password: string; storeId: string }) => {
    const config = getAppConfig();
    const vpsApiUrl = config.vpsApiUrl;

    try {
      const response = await fetch(`${vpsApiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: data.phone, password: data.password, storeId: data.storeId }),
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
    // apiUrl is pinned to the URL setup actually authenticated against. seed.ts derives the same
    // value from VPS_API_URL, so today these agree — but the row was previously left to the seed
    // by implication rather than by intent, which breaks the moment anything moves AppConfig
    // before setup finishes. Writing it here makes "the terminal talks to the server it was set
    // up against" an invariant instead of a coincidence.
    //
    // mode/posAdminLocked are the one-time activation: the wizard pulled them from
    // GET /stores/{id}, and an OFFLINE_ONLY terminal never needs the network again after this.
    await prisma.localConfig.update({
      where: { id: 'config' },
      data: {
        storeId: data.storeId,
        storeName: data.storeName,
        terminalId: data.terminalId,
        apiUrl: getAppConfig().vpsApiUrl,
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

    // 8. Update AppConfig to reflect new storeId/terminalId
    updateConfig({ storeId: data.storeId, terminalId: data.terminalId });

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
