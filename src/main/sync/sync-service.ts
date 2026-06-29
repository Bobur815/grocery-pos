import { BrowserWindow } from 'electron';
import { syncSales, SalesSyncResult } from './sales-sync';
import { syncProducts, syncCategories, syncSuppliers, syncUsers, syncSettings } from './products-sync';
import { getCurrentUser } from '../ipc/auth-handlers';
import { uploadLocalData } from './upload-sync';
import { getAppConfig } from '../config/app-config';
import { getPrismaClient } from '../database/sqlite-client';
import { getServerToken, clearServerToken } from './queue-manager';
import { flushLogs } from '../logger';

function decodeTokenStoreId(token: string): string | null | undefined {
  try {
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString()) as { storeId?: string | null; exp?: number };
    if (payload.exp && payload.exp * 1000 <= Date.now()) return undefined;
    return payload.storeId ?? null;
  } catch {
    return undefined;
  }
}

export class SyncService {
  private syncInterval: NodeJS.Timeout | null = null;
  private isSyncing = false;
  private lastSyncTime: Date | null = null;
  private lastError: string | null = null;
  private lastSalesSync: SalesSyncResult | null = null;

  start(): void {

    // Initial sync after a short delay (faster in dev/local mode)
    const config = getAppConfig();
    const isLocal = config.vpsApiUrl.includes('localhost') || config.vpsApiUrl.includes('127.0.0.1');
    setTimeout(() => {
      this.sync();
    }, isLocal ? 1000 : 5000);

    // Periodic sync
    this.syncInterval = setInterval(() => {
      this.sync();
    }, config.syncIntervalMs);
  }

  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  async sync(): Promise<void> {
    if (this.isSyncing) {
      return;
    }

    this.isSyncing = true;
    this.lastError = null;

    try {
      const token = getServerToken();
      if (!token) {
        // Not logged in yet — skip silently until user authenticates
        return;
      }

      // Guard: verify the server token is scoped to this terminal's store
      const prisma = getPrismaClient();
      const localConfig = await prisma.localConfig.findUnique({ where: { id: 'config' } });
      if (localConfig?.storeId) {
        const tokenStoreId = decodeTokenStoreId(token);
        console.log(`[sync] guard — token.storeId=${tokenStoreId ?? 'null'} localConfig.storeId=${localConfig.storeId}`);
        if (tokenStoreId !== undefined && tokenStoreId !== localConfig.storeId) {
          console.warn(`[sync] Token storeId (${tokenStoreId ?? 'null'}) ≠ LocalConfig storeId (${localConfig.storeId}) — clearing stale token, skipping sync`);
          clearServerToken();
          return;
        }
      }

      // Check internet connectivity
      const isOnline = await this.checkConnectivity();
      if (!isOnline) {
        console.warn('[sync] VPS unreachable — skipping sync cycle');
        return;
      }

      const currentUser = getCurrentUser();

      console.log(`[sync] Cycle start — user: ${currentUser?.phone ?? 'none'}, role: ${currentUser?.role ?? 'none'}`);

      // Upload locally-created categories, suppliers, products, and arrivals to VPS
      // Only ADMIN users have permission to upload product/supplier/category data
      if (currentUser?.role === 'ADMIN') {
        try {
          await uploadLocalData();
        } catch (uploadError) {
          console.error('Upload sync failed (non-fatal):', uploadError instanceof Error ? uploadError.message : uploadError);
        }
      }

      // Sync sales (upload local sales to VPS) — all roles
      try {
        this.lastSalesSync = await syncSales();
        if (this.lastSalesSync.failed > 0 || this.lastSalesSync.skippedReason) {
          this.notifyRenderer('sync:salesStatus', this.lastSalesSync);
        }
      } catch (salesError) {
        console.error('Sales sync failed (non-fatal):', salesError instanceof Error ? salesError.message : salesError);
      }

      // Sync categories (download from VPS — must come before products)
      await syncCategories();

      // Sync suppliers, users, and store settings (download from VPS to all terminals)
      await syncSuppliers();
      await syncUsers();
      await syncSettings();

      // Sync products (download updated products from VPS)
      const stockConflicts = await syncProducts();

      // Pull store config (AI token limit, etc.) from VPS
      await this.syncStoreConfig();

      // Send heartbeat to VPS so admins can monitor all terminals
      await this.sendHeartbeat();

      // Upload buffered logs to VPS for super admin visibility
      await this.uploadLogs();

      this.lastSyncTime = new Date();

      // Notify renderer process
      this.notifyRenderer('sync:completed');

      // Warn if any products have negative stock after VPS overwrite
      if (stockConflicts.length > 0) {
        this.notifyRenderer('sync:stockConflict', stockConflicts);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError = errorMessage;
      console.error('Sync failed:', errorMessage);

      // Notify renderer about error
      this.notifyRenderer('sync:failed', { message: errorMessage });
    } finally {
      this.isSyncing = false;
    }
  }

  // Fetches server-controlled config keys (e.g. AI token limit) from VPS.
  // The VPS should expose GET /store-config returning { ai_token_limit_daily: number }.
  // Silently skips if the endpoint is unavailable.
  private async syncStoreConfig(): Promise<void> {
    const config = getAppConfig();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const token = getServerToken();
      const response = await fetch(`${config.vpsApiUrl}/store-config`, {
        signal: controller.signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      clearTimeout(timeoutId);
      if (!response.ok) return;

      const data = await response.json() as Record<string, unknown>;
      const prisma = getPrismaClient();

      if (typeof data.ai_token_limit_daily === 'number') {
        await prisma.systemSetting.upsert({
          where: { key: 'ai_token_limit_daily' },
          update: { value: String(data.ai_token_limit_daily) },
          create: { key: 'ai_token_limit_daily', value: String(data.ai_token_limit_daily) },
        });
      }
    } catch {
      // Offline or endpoint not yet implemented — use cached limit
    }
  }

  private async uploadLogs(): Promise<void> {
    const entries = flushLogs();
    if (entries.length === 0) return;
    const config = getAppConfig();
    const token = getServerToken();
    if (!token) return;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      await fetch(`${config.vpsApiUrl}/logs/upload`, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminalId: config.terminalId, storeId: config.storeId, entries }),
      });
      clearTimeout(timeoutId);
    } catch {
      // fire-and-forget — entries are already saved to local log file
    }
  }

  private async sendHeartbeat(): Promise<void> {
    const config = getAppConfig();
    const token = getServerToken();
    if (!token) return;

    try {
      const prisma = getPrismaClient();
      const unsyncedCount = await prisma.sale.count({ where: { synced: false } });
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      await fetch(`${config.vpsApiUrl}/terminals/heartbeat`, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          terminalId: config.terminalId,
          storeId: config.storeId,
          unsyncedCount,
          lastSyncAt: new Date().toISOString(),
        }),
      });
      clearTimeout(timeoutId);
    } catch {
      // Heartbeat is fire-and-forget — VPS endpoint may not exist yet
    }
  }

  private async checkConnectivity(): Promise<boolean> {
    const config = getAppConfig();

    // Skip connectivity check for local development
    const isLocal = config.vpsApiUrl.includes('localhost') || config.vpsApiUrl.includes('127.0.0.1');
    if (isLocal) {
      return true;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${config.vpsApiUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  private notifyRenderer(channel: string, data?: unknown): void {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      windows[0].webContents.send(channel, data);
    }
  }

  getStatus(): {
    isSyncing: boolean;
    lastSyncTime: Date | null;
    lastError: string | null;
    lastSalesSync: SalesSyncResult | null;
  } {
    return {
      isSyncing: this.isSyncing,
      lastSyncTime: this.lastSyncTime,
      lastError: this.lastError,
      lastSalesSync: this.lastSalesSync,
    };
  }

  // Force immediate sync
  async triggerSync(): Promise<void> {
    await this.sync();
  }
}
